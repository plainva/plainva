/**
 * Where the formula budget of the reading view comes from
 * (`MATH_NODE_BUDGET` and `MATH_WORST_NODES_PER_CHAR` in
 * `src/readerMathBudget.ts`).
 *
 *   pnpm exec tsx scripts/perf/reader-math.ts calibrate        # main's limits and what they made (minutes)
 *   pnpm exec tsx scripts/perf/reader-math.ts run <budget|main> <shape> <count> <len>
 *
 * The reading view's math path as the desktop app runs it (GFM, remark-math,
 * remark-rehype, KaTeX), each run in a child process whose V8 old space is
 * capped at 128 MB. `main` lays out every formula (no budget); a budget runs
 * `rehypeReaderMath`. `calibrate` finds, for each shape of ordinary formulas,
 * the most formulas `main` lays out under the cap and how many nodes KaTeX
 * made of them — the budget must hold each — and, for each dear shape of a
 * single formula, the longest one `main` lays out and its nodes for each
 * character of source — the dearest is `MATH_WORST_NODES_PER_CHAR`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { overBudgetInlineRanges, READER_READING, TABLE_READ_BUDGET } from "../../src/inlineParseBudget.js";
import { MATH_NODE_BUDGET, mathBudgetBeside, mathNodeCount, rehypeReaderMath, type MathHastNode } from "../../src/readerMathBudget.js";

const here = fileURLToPath(import.meta.url);
const desktop = createRequire(path.resolve(path.dirname(here), "../../../../apps/desktop/package.json"));
const fromDesktop = async (name: string, from = desktop) => ((await import(pathToFileURL(from.resolve(name)).href)) as { default: unknown }).default;

const HEAP_MB = 128;

const TERMS = ["\\frac{a_{i}}{b^{2}}", "\\sum_{k=1}^{n} x_k", "\\sqrt{y}", "\\alpha^2", "e^{i\\pi}", "x_{n+1}"];
/** A formula of about `len` characters of TeX, ordinary terms. */
const tex = (k: number, len: number) => {
  let s = `${k}`;
  let i = k;
  while (s.length < len - 3) s += ` + ${TERMS[i++ % TERMS.length]}`;
  return s;
};
const fit = (unit: string, room: number) => unit.repeat(Math.max(1, Math.floor(room / unit.length)));

/** Notes of `count` ordinary formulas of about `len` characters (the second review's forms, `math11.mts`). */
export const ORDINARY: Record<string, (count: number, len: number) => string> = {
  inline: (count, len) => Array.from({ length: Math.ceil(count / 10) }, (_, p) => Array.from({ length: 10 }, (_, i) => `Step ${p * 10 + i}: we have $${tex(p * 10 + i, len)}$ and so on.`).join(" ")).join("\n\n"),
  block: (count, len) => Array.from({ length: count }, (_, k) => `Equation ${k}:\n\n$$\n${tex(k, len)}\n$$\n`).join("\n"),
  cells: (count, len) => `| n | formula |\n|---|---|\n` + Array.from({ length: count }, (_, k) => `| ${k} | $${tex(k, len)}$ |`).join("\n"),
  footnotes: (count, len) => Array.from({ length: count }, (_, k) => `Claim ${k}[^f${k}].`).join(" ") + "\n\n" + Array.from({ length: count }, (_, k) => `[^f${k}]: Since $${tex(k, len)}$.`).join("\n"),
  list: (count, len) => Array.from({ length: count }, (_, k) => `- item $${tex(k, len)}$`).join("\n"),
  letters: (count) => Array.from({ length: Math.ceil(count / 20) }, () => Array.from({ length: 20 }, () => "$a$").join(" ")).join("\n\n"),
};

/** One display formula of `room` characters of a dear shape (`kat11.mts`); `count` is ignored. */
export const DEAR: Record<string, (room: number) => string> = {
  matrix: (room) => `\\begin{matrix}${fit("a&b\\\\", room - 30)}\\end{matrix}`,
  matrixWide: (room) => `\\begin{matrix}${fit("a&", room - 30)}b\\end{matrix}`,
  nestFrac: (room) => { const d = Math.floor((room - 10) / 9); return "\\frac{".repeat(d) + "x" + "}{y}".repeat(d); },
  nestSqrt: (room) => { const d = Math.floor((room - 10) / 7); return "\\sqrt{".repeat(d) + "x" + "}".repeat(d); },
  overbrace: (room) => { const d = Math.floor((room - 10) / 15); return "\\overbrace{".repeat(d) + "x" + "}^{a}".repeat(d); },
  subsup: (room) => { const d = Math.floor((room - 10) / 4); return "x" + "^{x".repeat(d) + "}".repeat(d); },
  boxed: (room) => fit("\\boxed{\\boxed{x}}", room),
  arrays: (room) => `\\begin{array}{${"c".repeat(400)}}${fit("1&", room - 450)}\\end{array}`,
  cases: (room) => fit("\\begin{cases}a&b\\\\c&d\\end{cases}", room),
  colorbox: (room) => fit("\\colorbox{red}{$x$}", room),
  text: (room) => fit("\\text{abc}", room),
};

export function noteOf(shape: string, count: number, len: number): string {
  if (ORDINARY[shape]) return `# Notes\n\n${ORDINARY[shape](count, len)}\n`;
  return `# K\n\n${Array.from({ length: Math.max(1, count) }, () => `$$\n${DEAR[shape](len)}\n$$\n`).join("\n")}`;
}

/** The nodes of every formula KaTeX laid out in `tree` (`.katex` and `.katex-error` with all they hold). */
function katexNodes(tree: MathHastNode): number {
  const names = tree.properties?.className;
  if (Array.isArray(names) && (names.includes("katex") || names.includes("katex-error") || names.includes("katex-display"))) return mathNodeCount([tree]);
  let count = 0;
  for (const child of tree.children ?? []) count += katexNodes(child);
  return count;
}

/** Runs the math path on one note in this process: what KaTeX laid out, what stayed as source, the nodes it made. */
async function runOne(budget: string, shape: string, count: number, len: number) {
  const remarkMath = await fromDesktop("remark-math");
  const rehypeKatex = (await fromDesktop("rehype-katex")) as () => (tree: MathHastNode, file: unknown) => void;
  const remarkRehype = await fromDesktop("remark-rehype", createRequire(desktop.resolve("react-markdown")));
  const { VFile } = (await import(pathToFileURL(createRequire(desktop.resolve("react-markdown")).resolve("vfile")).href)) as { VFile: new (v: string) => { data: Record<string, unknown> } };
  const text = noteOf(shape, count, len);
  // `head`: as the reading view runs it, the formulas beside the note's tables get what the tables leave (`mathBudgetBeside`).
  let tableWeight = 0;
  if (budget === "head") overBudgetInlineRanges(text, { table: (_first, _last, _exact, cost) => { if (cost <= TABLE_READ_BUDGET) tableWeight += cost; } }, READER_READING);
  const limit = budget === "main" ? Infinity : budget === "head" ? mathBudgetBeside(tableWeight) : Number(budget);
  let made = 0;
  const layout = rehypeKatex();
  // What KaTeX made: everything the step put in place of the formulas it laid out.
  const counted = (tree: MathHastNode, file: unknown) => {
    layout(tree, file);
    made += limit === Infinity ? katexNodes(tree) : mathNodeCount(tree.children ?? []);
  };
  // `main`: KaTeX's own step over the whole tree, as the reading view ran it before the formula budget.
  const base = unified().use(remarkParse).use(remarkGfm).use(remarkMath as never).use(remarkRehype as never);
  const processor = limit === Infinity ? base.use((() => counted) as never) : base.use((() => rehypeReaderMath({ layout: counted, budget: limit })) as never);
  const file = new VFile(text);
  const t0 = performance.now();
  const tree = processor.runSync(processor.parse(file as never), file as never) as MathHastNode;
  const ms = performance.now() - t0;
  let laid = 0;
  const walk = (node: MathHastNode) => {
    const names = node.properties?.className;
    if (Array.isArray(names) && (names.includes("katex") || names.includes("katex-error"))) laid++;
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  console.log(JSON.stringify({ shape, count, len, chars: text.length, laid, left: file.data.mathLeftAsSource ?? 0, made, ms: Math.round(ms), heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) }));
}

/** One run in a child process under the cap: its result, or null when it ran out of memory. */
export function capped(budget: string, shape: string, count: number, len: number): { laid: number; left: number; made: number; ms: number; heapMB: number } | null {
  const run = spawnSync(process.execPath, [...process.execArgv, `--max-old-space-size=${HEAP_MB}`, here, "run", budget, shape, String(count), String(len)], { encoding: "utf8", maxBuffer: 1 << 26 });
  const line = run.stdout.split("\n").find((l) => l.startsWith("{"));
  return run.status === 0 && line ? JSON.parse(line) : null;
}

/** The largest value in [low, high] for which `ok` holds, `ok(low)` assumed. */
function largest(low: number, high: number, ok: (n: number) => boolean): number {
  while (high - low > Math.max(1, Math.floor(low / 50))) {
    const mid = Math.floor((low + high) / 2);
    if (ok(mid)) low = mid;
    else high = mid;
  }
  return low;
}

async function calibrate(only?: string) {
  if (only !== "dear") {
  console.log(`ordinary formulas: main's limit under ${HEAP_MB} MB and the nodes KaTeX made of it`);
  for (const [shape, len] of [["inline", 35], ["inline", 20], ["block", 500], ["cells", 40], ["footnotes", 40], ["list", 40], ["letters", 3]] as const) {
    const limit = largest(10, 40_000, (n) => capped("main", shape, n, len) !== null);
    const at = capped("main", shape, limit, len)!;
    console.log(`${shape} ×${len}: ${limit} formulas, ${at.made} nodes (${(at.made / MATH_NODE_BUDGET).toFixed(2)} × the budget), ${at.heapMB} MB`);
  }
  }
  console.log(`dear single formulas: the longest main lays out under ${HEAP_MB} MB and its nodes per character`);
  for (const shape of Object.keys(DEAR)) {
    const room = largest(500, 60_000, (n) => capped("main", shape, 1, n) !== null);
    const at = capped("main", shape, 1, room)!;
    console.log(`${shape}: ${room} characters, ${at.made} nodes, ${(at.made / room).toFixed(1)} per character, ${at.heapMB} MB`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "run") await runOne(rest[0], rest[1], Number(rest[2]), Number(rest[3]));
else if (mode === "calibrate") await calibrate(rest[0]);
