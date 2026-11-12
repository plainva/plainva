/**
 * Where the table budget of the parse budget comes from (Gesamtplan Leistung
 * L13; `TABLE_READ_BUDGET` and `tableReadCost` in `src/inlineParseBudget.ts`).
 *
 *   pnpm --filter @plainva/core perf:tables -- --calibrate   # search limits, choose weights, check (about half an hour)
 *   pnpm --filter @plainva/core perf:tables -- --check       # check the constants only (minutes)
 *       [--seed <n>] [--generated <count>]                   # the generated shapes of the check
 *
 * The criterion: a table of every shape below, at the budget, is read by the
 * index parse (`parseMarkdownAst` with Obsidian syntax) and by the note-source
 * parse (`parseMarkdownTree`) in a process whose V8 old space is capped at
 * `HEAP_MB`. Each parse runs in a child process of its own with
 * `--max-old-space-size`; one that runs out of memory fails.
 *
 * `--calibrate` finds, for each fixed shape, the most rows both parses read
 * under the cap, and chooses the weights of `tableReadCost` as an upper bound:
 * for every pair of weights it takes the budget as nine tenths of the lightest
 * shape's limit — so that every shape's limit weighs at least the budget / 0.9
 * — and keeps the pair that leaves the commonest table (a word and a link) the
 * most rows. The costliest shape of each part (characters, cells, inline
 * syntax) decides its weight that way.
 *
 * `--check` holds the constants as they stand against every fixed shape (at
 * the budget and at the budget / 0.9, both must pass) and against generated
 * shapes (at the budget, must pass): seeded and reproducible, 1 to 24
 * columns, cells of 0 to 80 characters, outer pipes on and off, blanks around
 * cells on and off, pipes escaped with one, two and three backslashes, inline
 * syntax of four densities, code spans, empty cells among filled ones. A
 * failure prints the seed, the shape's settings and its first row. Re-run both
 * when the parser changes; raising the budget beyond what passes here needs a
 * measurement in the phone's WebView first.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { TABLE_CELL_WEIGHT, TABLE_READ_BUDGET, TABLE_SYNTAX_WEIGHT, tableReadCost, tableRowParts } from "../../src/inlineParseBudget.js";
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
  /** The header row and the delimiter row. */
  header: string;
  row: (i: number) => string;
}

const BS = "\\";
const cols = (n: number) => `|${" h |".repeat(n)}\n|${"---|".repeat(n)}`;
const repeatCell = (unit: string) => `| ${unit.repeat(150)} |`;

/** The fixed shapes: what people write, and for each part of the weight the shapes that cost most for it. */
export const SHAPES: Record<string, Shape> = {
  // A word and a link: the commonest long table.
  short: { header: cols(2), row: (i) => `| row ${i} | [[n${i}]] |` },
  // Four short cells and a link.
  cells: { header: cols(4), row: (i) => `| [[N${i}]] | b | c | d |` },
  // Four cells of words.
  words: { header: cols(4), row: (i) => `| item ${i} | [[Note ${i % 999}]] | open | some words of a note for row ${i} here |` },
  // Links, emphasis, code, HTML, footnotes and autolinks in every cell.
  inline: { header: cols(6), row: (i) => `| *a* **b** _c_ ~~d~~ | [l${i}](u${i}) \`c${BS}|x\` | [[n${i}${BS}|alias]] <b>x</b> | [^${i}] <http://x${i}.com> | www.x${i}.com #tag${i} | [ ] ![i](p) &amp; |` },
  // One long cell of words: characters, hardly any cells.
  prose: { header: cols(1), row: (i) => `| ${i} ${"word ".repeat(60)}|` },
  // Literal autolinks: syntax the weight does not count.
  autolinks: { header: cols(2), row: (i) => `| www.a${i}.com www.b${i}.org https://c${i}.net/x?y=${i} | x |` },
  // Umlauts, CJK, emoji.
  uni: { header: cols(3), row: (i) => `| äöüß ${i} | 日本語のテキスト | \u{1F600}\u{1F600} café |` },
  // Inline HTML.
  html: { header: cols(2), row: (i) => `| <span class="x">v${i}</span><br><br> | <a href="u">t</a> |` },
  // Cells: eight empty ones, sixteen of one character without blanks, rows without outer pipes.
  empty: { header: cols(8), row: () => "| | | | | | | | |" },
  dense: { header: `|${"h|".repeat(16)}\n|${"-|".repeat(16)}`, row: () => `|${"a|".repeat(16)}` },
  nopipe: { header: "h | h | h\n---|---|---", row: (i) => `a${i} | b | c` },
  // Escaped pipes: `\\|` is a boundary, `\|` and `\\\|` are not; and pipes inside code spans.
  dblesc: { header: cols(8), row: () => `|a${BS}${BS}|a${BS}${BS}|a${BS}${BS}|a${BS}${BS}|a${BS}${BS}|a${BS}${BS}|a${BS}${BS}|a|` },
  triple: { header: cols(2), row: (i) => `| a${BS}${BS}${BS}|b${BS}${BS}${BS}|c ${i} | d${BS}${BS}${BS}|e |` },
  codepipe: { header: cols(2), row: (i) => "| `a" + BS + "|b" + BS + "|c" + BS + "|d` | x" + i + " |" },
  // Inline syntax, one kind per shape, every row under the row budget.
  brackets: { header: cols(2), row: () => `| ${"[".repeat(200)} | ${"*a".repeat(200)} |` },
  stars: { header: cols(1), row: () => repeatCell("*a") },
  unders: { header: cols(1), row: () => repeatCell("_a") },
  tildes: { header: cols(1), row: () => repeatCell("~a") },
  ticks: { header: cols(1), row: () => repeatCell("`a") },
  amps: { header: cols(1), row: () => repeatCell("&a") },
  angles: { header: cols(1), row: () => repeatCell("<a") },
  bangs: { header: cols(1), row: () => repeatCell("![") },
};

/** A seeded generator (mulberry32) over a list of integers. */
function random(...keys: number[]): () => number {
  let s = 0x9e3779b9;
  for (const k of keys) s = Math.imul(s ^ (k >>> 0), 0x85ebca6b) ^ (s >>> 13);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedSettings { columns: number; length: number; outer: boolean; blanks: boolean; escape: number; escapeRate: number; syntax: number; code: number; empty: number }

const SYNTAX_CHARS = "[]*_~`<&!$";
const LETTERS = "abcdefghij klmno pqrst uvwxyz";

/** The settings of generated shape `k` of `seed`. */
function settingsOf(seed: number, k: number): GeneratedSettings {
  const r = random(seed, k);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const columns = 1 + Math.floor(r() * 24);
  return {
    columns,
    length: Math.floor(r() * 81),
    outer: columns === 1 || r() < 0.5,
    blanks: r() < 0.5,
    escape: Math.floor(r() * 4),
    escapeRate: pick([0, 0.2, 0.6]),
    syntax: pick([0, 0.05, 0.2, 0.5]),
    code: pick([0, 0.3]),
    empty: pick([0, 0.3, 0.7]),
  };
}

function generatedShape(seed: number, k: number): Shape {
  const s = settingsOf(seed, k);
  const join = (cells: string[]) => {
    const inner = cells.join(s.blanks ? " | " : "|");
    return s.outer ? (s.blanks ? `| ${inner} |` : `|${inner}|`) : inner;
  };
  const cell = (i: number, c: number) => {
    const r = random(seed, k, i, c);
    if (c > 0 && r() < s.empty) return "";
    let text = "";
    const length = Math.floor(r() * (s.length + 1));
    for (let n = 0; n < length; n++) {
      if (s.escape > 0 && r() < s.escapeRate / 8) text += BS.repeat(s.escape) + "|";
      else if (r() < s.syntax) text += SYNTAX_CHARS[Math.floor(r() * SYNTAX_CHARS.length)];
      else text += LETTERS[Math.floor(r() * LETTERS.length)];
    }
    if (r() < s.code) text = "`" + text + "`";
    // A row without outer pipes must not begin like another block (a list item, a quote, a heading).
    return c === 0 ? `c${text}` : text;
  };
  return {
    header: `${join(Array.from({ length: s.columns }, () => "h"))}\n${join(Array.from({ length: s.columns }, () => "---"))}`,
    row: (i) => join(Array.from({ length: s.columns }, (_, c) => cell(i, c))),
  };
}

/** A fixed shape by its name, a generated one as `gen:<seed>:<k>`. */
function shapeOf(name: string): Shape {
  if (name.startsWith("gen:")) {
    const [, seed, k] = name.split(":");
    return generatedShape(Number(seed), Number(k));
  }
  return SHAPES[name];
}

export function shapeTable(name: string, rows: number): string {
  const shape = shapeOf(name);
  return `# Table\n\n${shape.header}\n${Array.from({ length: rows }, (_, i) => shape.row(i)).join("\n")}\n\nbelow [[Link]]\n`;
}

type Parts = { chars: number; cells: number; syntax: number };

/** The parts of a shape's header and first `rows` rows, summed: what its table's weight is made of, under any weights. */
function tableParts(name: string, rows: number): Parts {
  const shape = shapeOf(name);
  const sum = { chars: 0, cells: 0, syntax: 0 };
  const header = shape.header.split("\n")[0];
  for (const row of [header, ...Array.from({ length: rows }, (_, i) => shape.row(i))]) {
    const parts = tableRowParts(row, 0, row.length);
    sum.chars += parts.chars;
    sum.cells += parts.cells;
    sum.syntax += parts.syntax;
  }
  return sum;
}

const weigh = (parts: Parts, cell: number, syntax: number) => parts.chars + cell * parts.cells + syntax * parts.syntax;

/** The rows of a shape whose table weighs `target` by the constants as they stand. */
function rowsAt(name: string, target: number): number {
  const shape = shapeOf(name);
  const header = shape.header.split("\n")[0];
  let weight = tableReadCost(header, 0, header.length);
  let rows = 0;
  for (;;) {
    const row = shape.row(rows);
    const next = weight + tableReadCost(row, 0, row.length);
    if (next > target) return rows;
    weight = next;
    rows++;
  }
}

const HERE = fileURLToPath(import.meta.url);
const CORE = path.resolve(path.dirname(HERE), "../..");

/** Whether both parses read `rows` rows of `name` under the cap, each in a process of its own. */
function passes(name: string, rows: number, bounded: boolean): { ok: boolean; ms: number; why: string } {
  let ms = 0;
  for (const parse of ["index", "tree"]) {
    const run = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, "--import", "tsx", HERE, bounded ? "--child" : "--child-unbounded", name, String(rows), parse], { cwd: CORE, encoding: "utf8", timeout: 300_000 });
    const out = /^ok (\d+)/m.exec(run.stdout ?? "");
    if (run.status !== 0 || !out) {
      const why = /not read as a table[^\n]*/.exec(run.stderr ?? "")?.[0] ?? (/heap out of memory|Allocation failed/i.test(run.stderr ?? "") ? "out of memory" : `exit ${run.status}`);
      return { ok: false, ms, why: `${parse}: ${why}` };
    }
    ms += Number(out[1]);
  }
  return { ok: true, ms, why: "" };
}

/** The most rows of `name` both parses read under the cap, to within 4 %. */
function limitOf(name: string): number {
  let lo = 0;
  let hi = Math.max(8, rowsAt(name, TABLE_READ_BUDGET / 2));
  while (passes(name, hi, false).ok) { lo = hi; hi *= 2; }
  while (hi - lo > Math.max(1, lo * 0.04)) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(name, mid, false).ok) lo = mid; else hi = mid;
  }
  return lo;
}

function calibrate(): void {
  const limits: Record<string, Parts> = {};
  for (const name of Object.keys(SHAPES)) {
    const rows = limitOf(name);
    limits[name] = tableParts(name, rows);
    console.log(`limit    ${name.padEnd(10)} ${String(rows).padStart(7)} rows under ${HEAP_MB} MB`);
  }
  const short = tableParts("short", 1000);
  // For each pair of weights the budget is nine tenths of the lightest limit; keep the pair that leaves a word and a link the most rows.
  let best = { cell: 0, syntax: 0, budget: 0, shortRows: 0 };
  for (let cell = 0; cell <= 120; cell++) {
    for (let syntax = 0; syntax <= 40; syntax++) {
      const budget = 0.9 * Math.min(...Object.values(limits).map((parts) => weigh(parts, cell, syntax)));
      const shortRows = (budget / weigh(short, cell, syntax)) * 1000;
      if (shortRows > best.shortRows) best = { cell, syntax, budget, shortRows };
    }
  }
  const budget = Math.floor(best.budget / 10_000) * 10_000;
  console.log(`weights  cell ${best.cell}, syntax ${best.syntax}: proposed budget ${budget} (a word and a link: about ${Math.round(best.shortRows)} rows)`);
  for (const [name, parts] of Object.entries(limits)) console.log(`         ${name.padEnd(10)} limit weighs ${(weigh(parts, best.cell, best.syntax) / budget).toFixed(2)} x the budget`);
}

function check(args: string[]): boolean {
  const at = (flag: string, fallback: number) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
  const seed = at("--seed", 20261112);
  const generated = at("--generated", 36);
  const started = performance.now();
  let all = true;
  console.log(`check    budget ${TABLE_READ_BUDGET}, cell ${TABLE_CELL_WEIGHT}, syntax ${TABLE_SYNTAX_WEIGHT}, ${HEAP_MB} MB; ${Object.keys(SHAPES).length} fixed shapes, ${generated} generated (seed ${seed})`);
  const names = [...Object.keys(SHAPES), ...Array.from({ length: generated }, (_, k) => `gen:${seed}:${k}`)];
  for (const name of names) {
    const fixed = !name.startsWith("gen:");
    const rows = rowsAt(name, TABLE_READ_BUDGET);
    const margin = rowsAt(name, TABLE_READ_BUDGET / 0.9);
    const a = passes(name, rows, true);
    // Over the budget the app reads the table as written; the margin shows without the budget.
    const b = passes(name, margin, false);
    const ok = a.ok && (!fixed || b.ok);
    all &&= ok;
    const label = fixed ? name : `gen ${name.split(":")[2]}`;
    console.log(`         ${label.padEnd(10)} at budget ${String(rows).padStart(6)} rows ${a.ok ? "pass" : "FAIL"} (${a.ms} ms)   at budget/0.9 ${String(margin).padStart(6)} rows ${b.ok ? "pass" : fixed ? "FAIL" : "fail"}`);
    if (!ok) {
      const shape = shapeOf(name);
      console.log(`           ${a.why || b.why}; ${fixed ? "" : `seed ${seed}, shape ${name.split(":")[2]}, ${JSON.stringify(settingsOf(seed, Number(name.split(":")[2])))}; `}first row ${JSON.stringify(shape.row(0))}`);
    }
  }
  console.log(`check    ${all ? "every shape passes" : "FAILED"} in ${Math.round((performance.now() - started) / 1000)} s`);
  return all;
}

/**
 * The two parses of `markdown-parser.ts` without the parse budget: the search
 * for a shape's limit must read tables the budget would read as written. The
 * check at the budget reads through the app's own entry points.
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
  if (!check(args)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--child" || args[0] === "--child-unbounded") child(args[1], Number(args[2]), args[3], args[0] === "--child");
  else runTableBudget(args);
}
