/**
 * Where the table budget of the parse budget comes from (Gesamtplan Leistung
 * L13; `TABLE_READ_BUDGET` and `tableReadCost` in `src/inlineParseBudget.ts`).
 *
 *   pnpm --filter @plainva/core perf:tables -- --calibrate   # search, fit, check (minutes)
 *   pnpm --filter @plainva/core perf:tables -- --check       # check the constants only
 *
 * The criterion: a table of every shape below, at the budget, is read by the
 * index parse (`parseMarkdownAst` with Obsidian syntax) and by the note-source
 * parse (`parseMarkdownTree`) in a process whose V8 old space is capped at
 * `HEAP_MB`. Each parse runs in a child process of its own with
 * `--max-old-space-size`; one that runs out of memory fails.
 *
 * `--calibrate` finds, for each shape, the most rows both parses read under
 * the cap, fits the three weights of `tableReadCost` so that the shapes' tables
 * at that limit weigh as nearly the same as the weights can make them, and
 * proposes a budget a tenth under the lightest of them. Both modes then check
 * the constants as they stand: every shape at the budget must pass, and at
 * 1.25 times the budget shows how much room is left. Re-run it when the parser
 * changes; raising the budget beyond what passes here needs a measurement in
 * the phone's WebView first.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { TABLE_CELL_WEIGHT, TABLE_PIPE_WEIGHT, TABLE_READ_BUDGET, TABLE_SYNTAX_WEIGHT, tableReadCost, tableRowParts } from "../../src/inlineParseBudget.js";
import { markdownAstSchema } from "../../src/markdown-ast.js";
import { parseMarkdownAst, parseMarkdownTree } from "../../src/markdown-parser.js";
import remarkObsidianPreserve from "../../src/remark-obsidian-preserve.js";
import { remarkWikiLinks } from "../../src/wikiLinkSyntax.js";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** The V8 old space every parse must fit into. */
export const HEAP_MB = 128;

interface Shape {
  /** The header row; its cells count as the table's columns. */
  header: string;
  row: (i: number) => string;
}

const cols = (n: number) => `|${" h |".repeat(n)}\n|${"---|".repeat(n)}`;

/** Every shape of table the budget is held against: what people write, and what weighs least for what it costs. */
export const SHAPES: Record<string, Shape> = {
  // A word and a link: the commonest long table.
  short: { header: cols(2), row: (i) => `| row ${i} | [[n${i}]] |` },
  // Four short cells and a link: the most cells per character.
  cells: { header: cols(4), row: (i) => `| [[N${i}]] | b | c | d |` },
  // Four cells of words.
  words: { header: cols(4), row: (i) => `| item ${i} | [[Note ${i % 999}]] | open | some words of a note for row ${i} here |` },
  // Links, emphasis, code, HTML, footnotes and autolinks in every cell.
  inline: { header: cols(6), row: (i) => `| *a* **b** _c_ ~~d~~ | [l${i}](u${i}) \`c\\|x\` | [[n${i}\\|alias]] <b>x</b> | [^${i}] <http://x${i}.com> | www.x${i}.com #tag${i} | [ ] ![i](p) &amp; |` },
  // Openers without closers, every row under the row budget.
  brackets: { header: cols(2), row: () => `| ${"[".repeat(200)} | ${"*a".repeat(200)} |` },
  // Empty cells: nothing but cell boundaries.
  empty: { header: cols(8), row: () => "| | | | | | | | |" },
  // Literal autolinks: syntax the weight does not count.
  autolinks: { header: cols(2), row: (i) => `| www.a${i}.com www.b${i}.org https://c${i}.net/x?y=${i} | x |` },
  // One long cell of words: the fewest cells per character.
  prose: { header: cols(1), row: (i) => `| ${i} ${"word ".repeat(60)}|` },
};

export function shapeTable(name: string, rows: number): string {
  const shape = SHAPES[name];
  return `# Table\n\n${shape.header}\n${Array.from({ length: rows }, (_, i) => shape.row(i)).join("\n")}\n\nbelow [[Link]]\n`;
}

type Parts = ReturnType<typeof tableRowParts>;

/** The parts of a shape's first `rows` rows, summed: what its table's weight is made of, under any weights. */
function tableParts(name: string, rows: number): Parts {
  const sum = { chars: 0, pipes: 0, cells: 0, syntax: 0 };
  for (let i = 0; i < rows; i++) {
    const row = SHAPES[name].row(i);
    const parts = tableRowParts(row, 0, row.length);
    sum.chars += parts.chars;
    sum.pipes += parts.pipes;
    sum.cells += parts.cells;
    sum.syntax += parts.syntax;
  }
  return sum;
}

const weigh = (parts: Parts, pipe: number, cell: number, syntax: number) => parts.chars + pipe * parts.pipes + cell * parts.cells + syntax * parts.syntax;

/** The rows of a shape whose table weighs `target` by the constants as they stand. */
function rowsAt(name: string, target: number): number {
  const header = SHAPES[name].header.split("\n")[0];
  let weight = tableReadCost(header, 0, header.length);
  let rows = 0;
  for (;;) {
    const row = SHAPES[name].row(rows);
    const next = weight + tableReadCost(row, 0, row.length);
    if (next > target) return rows;
    weight = next;
    rows++;
  }
}

const HERE = fileURLToPath(import.meta.url);
const CORE = path.resolve(path.dirname(HERE), "../..");

/** Whether both parses read `rows` rows of `name` under the cap, each in a process of its own. */
function passes(name: string, rows: number, bounded: boolean): { ok: boolean; ms: number } {
  let ms = 0;
  for (const parse of ["index", "tree"]) {
    const run = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, "--import", "tsx", HERE, bounded ? "--child" : "--child-unbounded", name, String(rows), parse], { cwd: CORE, encoding: "utf8", timeout: 300_000 });
    const out = /^ok (\d+)/m.exec(run.stdout ?? "");
    if (run.status !== 0 || !out) return { ok: false, ms };
    ms += Number(out[1]);
  }
  return { ok: true, ms };
}

/** The most rows of `name` both parses read under the cap, to within 4 %. */
function limitOf(name: string): number {
  let lo = 0;
  let hi = rowsAt(name, TABLE_READ_BUDGET / 2);
  while (passes(name, hi, false).ok) { lo = hi; hi *= 2; }
  while (hi - lo > Math.max(1, lo * 0.04)) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(name, mid, false).ok) lo = mid; else hi = mid;
  }
  return lo;
}

function calibrate(): void {
  const limits: Record<string, { rows: number; parts: Parts }> = {};
  for (const name of Object.keys(SHAPES)) {
    const rows = limitOf(name);
    limits[name] = { rows, parts: tableParts(name, rows) };
    console.log(`limit    ${name.padEnd(10)} ${String(rows).padStart(7)} rows under ${HEAP_MB} MB`);
  }
  // The weights under which the shapes' limits weigh most nearly the same: the smallest spread, heaviest over lightest.
  let best = { pipe: 0, cell: 0, syntax: 0, spread: Infinity, lightest: 0 };
  for (let pipe = 0; pipe <= 40; pipe++) {
    for (let cell = 0; cell <= 80; cell++) {
      for (let syntax = 0; syntax <= 20; syntax++) {
        const weights = Object.values(limits).map(({ parts }) => weigh(parts, pipe, cell, syntax));
        const spread = Math.max(...weights) / Math.min(...weights);
        if (spread < best.spread) best = { pipe, cell, syntax, spread, lightest: Math.min(...weights) };
      }
    }
  }
  console.log(`fit      pipe ${best.pipe}, cell ${best.cell}, syntax ${best.syntax}: spread ${best.spread.toFixed(2)}x, proposed budget ${Math.floor((best.lightest * 0.9) / 10_000) * 10_000}`);
  for (const [name, { parts }] of Object.entries(limits)) console.log(`         ${name.padEnd(10)} limit weighs ${Math.round(weigh(parts, best.pipe, best.cell, best.syntax))}`);
}

function check(): boolean {
  let all = true;
  console.log(`check    budget ${TABLE_READ_BUDGET}, pipe ${TABLE_PIPE_WEIGHT}, cell ${TABLE_CELL_WEIGHT}, syntax ${TABLE_SYNTAX_WEIGHT}, ${HEAP_MB} MB`);
  for (const name of Object.keys(SHAPES)) {
    const at = rowsAt(name, TABLE_READ_BUDGET);
    const over = rowsAt(name, TABLE_READ_BUDGET * 1.25);
    const a = passes(name, at, true);
    // Over the budget the app reads the table as written; how much room there is shows without the budget.
    const b = passes(name, over, false);
    all &&= a.ok;
    console.log(`         ${name.padEnd(10)} at budget ${String(at).padStart(6)} rows ${a.ok ? "pass" : "FAIL"} (${a.ms} ms)   at 1.25x ${String(over).padStart(6)} rows ${b.ok ? "pass" : "fail"}`);
  }
  return all;
}

/**
 * The two parses of `markdown-parser.ts` without the parse budget: the search
 * for a shape's limit must read tables the budget would read as written. The
 * check reads through the app's own entry points.
 */
const unbounded = {
  index: (text: string) => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks).use(remarkObsidianPreserve);
    return markdownAstSchema.parse(processor.runSync(processor.parse(text)));
  },
  tree: (text: string) => unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks).parse(text),
};

function child(name: string, rows: number, parse: string, bounded: boolean): void {
  const text = shapeTable(name, rows);
  const started = performance.now();
  const tree = (bounded
    ? parse === "index" ? parseMarkdownAst(text, { preserveObsidianSyntax: true }) : parseMarkdownTree(text)
    : unbounded[parse as keyof typeof unbounded](text)) as { children?: Array<{ type: string }> };
  // A table the budget reads as written costs what plain text costs: only a table read as a table counts.
  if (tree.children?.[1]?.type !== "table") throw new Error(`not read as a table: ${tree.children?.[1]?.type}`);
  console.log(`ok ${Math.round(performance.now() - started)}`);
}

/** `perf:tables -- --calibrate` and `--check` (`many-tables.ts` hands them here). */
export function runTableBudget(args: string[]): void {
  if (args.includes("--calibrate")) calibrate();
  if (!check()) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--child" || args[0] === "--child-unbounded") child(args[1], Number(args[2]), args[3], args[0] === "--child");
  else runTableBudget(args);
}
