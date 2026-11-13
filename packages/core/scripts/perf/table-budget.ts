/**
 * Where the table budget of the parse budget comes from (Gesamtplan Leistung
 * L13; `TABLE_READ_BUDGET` and `tableReadCost` in `src/inlineParseBudget.ts`).
 *
 *   pnpm --filter @plainva/core perf:tables -- --calibrate   # search limits, choose weights, check (about half an hour)
 *   pnpm --filter @plainva/core perf:tables -- --check       # check the constants only (minutes)
 *       [--limits <calibration log>]                         # with --calibrate: take the limits a log holds, search the rest
 *       [--seed <n>] [--generated <count>]                   # the generated shapes of the check
 *
 * The criterion: a table of every shape below, at the budget, is read by the
 * index parse (`parseMarkdownAst` with Obsidian syntax) and by the note-source
 * parse (`parseMarkdownTree`) in a process whose V8 old space is capped at
 * `HEAP_MB` — and by the reading view's parser with its HTML tree
 * (`mdast-util-to-hast`, which fills every row to the header's columns). Each
 * parse runs in a child process of its own with
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
import { readFileSync } from "node:fs";
import { boundMarkdownForParse, READER_READING, TABLE_CELL_WEIGHT, TABLE_LITERAL_WEIGHT, TABLE_MARKER_WEIGHT, TABLE_READ_BUDGET, TABLE_LINK_WEIGHT, TABLE_MATH_WEIGHT, TABLE_REFERENCE_WEIGHT, TABLE_ROW_WEIGHT, TABLE_SYNTAX_WEIGHT, TABLE_WORD_WEIGHT, opensNoContainers, tableLineStart, tableMarkerCost, tableReadCost, tableRowParts } from "../../src/inlineParseBudget.js";
import { toHast } from "mdast-util-to-hast";
import { markdownAstSchema } from "../../src/markdown-ast.js";
import { parseMarkdownAst, parseMarkdownTree } from "../../src/markdown-parser.js";
import remarkObsidianPreserve from "../../src/remark-obsidian-preserve.js";
import { remarkWikiLinks } from "../../src/wikiLinkSyntax.js";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { createRequire } from "node:module";

/**
 * The reading view's math, as the desktop app loads it for a note with math
 * (`loadReaderMath` in `markdownReaderModel.ts`): `remark-math`, and
 * `remark-rehype` with `rehype-katex` for its page — KaTeX makes dozens of
 * elements of each formula. Resolved from the desktop app, whose packages they are.
 */
const desktop = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../apps/desktop/package.json"));
const fromDesktop = async (name: string, from = desktop) => ((await import(pathToFileURL(from.resolve(name)).href)) as { default: unknown }).default;
const remarkMath = await fromDesktop("remark-math");
const rehypeKatex = await fromDesktop("rehype-katex");
const remarkRehype = await fromDesktop("remark-rehype", createRequire(desktop.resolve("react-markdown")));
/** The reading view's test for math in a note (`MarkdownReader.tsx`). */
const HAS_MATH = /\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/;

/** The V8 old space every parse must fit into. */
export const HEAP_MB = 128;

interface Shape {
  /** The header row and the delimiter row, with the markers of the blocks the table stands in. */
  header: string;
  row: (i: number) => string;
  /** Lines before the header in the same block (a callout's head). */
  before?: string;
  /** Lines at the very start of the note, before its heading (an unclosed `---`). */
  start?: string;
  /** Lines right behind the table, before the blank line (a footnote's definition its rows refer to). */
  after?: string;
  /** The note's line ends are `\r\n`; it starts with a byte order mark. */
  crlf?: boolean;
  bom?: boolean;
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
  // Rows: one short cell each (the most rows per weight), one empty cell, two short cells.
  onecell: { header: "| h |\n|---|", row: () => "|a|" },
  emptycol: { header: "| h |\n|---|", row: () => "| |" },
  twoshort: { header: "| h | h |\n|---|---|", row: () => "|a|b|" },
  // Rows without a pipe: under a table, `a` is a row of one cell; and a header without one (`a` over `|-`).
  bare: { header: "| h |\n|---|", row: () => "a" },
  barewords: { header: cols(4), row: (i) => `item ${i} and some words` },
  nohead: { header: "a\n|-", row: () => "a" },
  // Rows with far fewer cells than the header: the parser does not pad them.
  ragged: { header: cols(64), row: () => "|a|" },
  ragged8: { header: cols(8), row: () => "|a|" },
  // Rows with far more cells than the header.
  excess: { header: "| h |\n|---|", row: () => `|${"a|".repeat(40)}` },
  // Containers: a quote, a callout, a list item, a quote in a list, a list in a quote, a footnote.
  quote: { header: "> | h | h |\n> |---|---|", row: (i) => `> | a${i} | [[n${i}]] |` },
  listed: { header: "- | h | h |\n  |---|---|", row: (i) => `  | a${i} | [[n${i}]] |` },
  qdense: { header: `> |${"h|".repeat(16)}\n> |${"-|".repeat(16)}`, row: () => `> |${"a|".repeat(16)}` },
  cdense: { before: "> [!note] Numbers", header: `> |${"h|".repeat(16)}\n> |${"-|".repeat(16)}`, row: () => `> |${"a|".repeat(16)}` },
  ldense: { header: `- |${"h|".repeat(16)}\n  |${"-|".repeat(16)}`, row: () => `  |${"a|".repeat(16)}` },
  lqdense: { header: `- > |${"h|".repeat(16)}\n  > |${"-|".repeat(16)}`, row: () => `  > |${"a|".repeat(16)}` },
  qldense: { header: `> - |${"h|".repeat(16)}\n>   |${"-|".repeat(16)}`, row: () => `>   |${"a|".repeat(16)}` },
  fdense: { header: `[^1]: |${"h|".repeat(16)}\n    |${"-|".repeat(16)}`, row: () => `    |${"a|".repeat(16)}` },
  // A delimiter row without a pipe (`:-`), rows of a lone pipe or two.
  colonbare: { header: "h\n:-", row: () => "a" },
  pipeonly: { header: "| h |\n|---|", row: () => "|" },
  dpipe: { header: "| h |\n|---|", row: () => "||" },
  // Behind an unclosed `---` on the first line the parser opens no quote or list: `- a` and `> b` are rows.
  nocontainers: { start: "---\n", header: "| h |\n|---|", row: (i) => (i % 2 ? `- a${i}` : `> b${i}`) },
  // Autolink literals: links without a character of syntax.
  emails: { header: "| h |\n|---|", row: () => `| ${"a@b.cc ".repeat(100)}|` },
  wwws: { header: "| h |\n|---|", row: () => `| ${"www.a.b ".repeat(100)}|` },
  urls: { header: "| h |\n|---|", row: () => `| ${"https://a.b ".repeat(60)}|` },
  wwwcaps: { header: "| h |\n|---|", row: () => `| ${"WWW.a.b ".repeat(100)}|` },
  // Words: at each start of a run of letters and digits the parser tries an address and holds the cell in pieces (review, 2026-11-13).
  aw: { header: "| h |\n|---|", row: () => `| ${"a ".repeat(150)}|` },
  nums: { header: "| h |\n|---|", row: (i) => `| ${Array.from({ length: 100 }, (_, k) => String(((i * 7 + k) % 90) + 10)).join(" ")} |` },
  eng: { header: "| h |\n|---|", row: () => `| ${"the cat sat on a mat and it was so ok to do ".repeat(7)}|` },
  de: { header: "| h |\n|---|", row: () => `| ${"Die Besprechung am Montag wurde auf den nächsten Termin verschoben, weil keiner Zeit hatte. ".repeat(3)}|` },
  dots: { header: "| h |\n|---|", row: () => `| ${".. ".repeat(100)}|` },
  // Other scripts, numbers with separators, emoji, combining marks: ten languages, Japanese and Chinese among them.
  cyrillic: { header: "| h |\n|---|", row: () => `| ${"это слово и ещё одно ".repeat(12)}|` },
  greek: { header: "| h |\n|---|", row: () => `| ${"αβ γδ εζ ηθ ".repeat(25)}|` },
  cjk: { header: "| h |\n|---|", row: () => `| ${"会議は月曜日に延期されました。".repeat(15)}|` },
  cjkspaced: { header: "| h |\n|---|", row: () => `| ${"中文 ".repeat(100)}|` },
  numsep: { header: "| h |\n|---|", row: (i) => `| ${Array.from({ length: 30 }, (_, k) => `1.234,${(i + k) % 90 + 10} 12:30 2026-11-${(k % 28) + 1}`).join(" ")} |` },
  emoji: { header: "| h |\n|---|", row: () => `| ${"😀 ".repeat(100)}|` },
  combining: { header: "| h |\n|---|", row: () => `| ${"e\u0301 ".repeat(100)}|` },
  // Footnote references with their definition below the table: each is a reference node.
  fnref: { header: "| h |\n|---|", row: () => `| ${"[^1] ".repeat(100)}|`, after: "\n[^1]: x" },
  fnmany: { header: "| h |\n|---|", row: (i) => `| ${Array.from({ length: 50 }, (_, k) => `[^${i * 50 + k}]`).join(" ")} |`, after: "\n[^1]: x" },
  refs: { header: "| h |\n|---|", row: () => `| ${"[a] ".repeat(100)}|`, after: "\n[a]: u" },
  // Addresses and `www.` without blanks between: one word a row, a literal each.
  emailc: { header: "| h |\n|---|", row: () => `| ${"a@b.cc,".repeat(100)}|` },
  wwwshort: { header: "| h |\n|---|", row: () => `| ${"www.a,".repeat(100)}|` },
  // Formulas: KaTeX makes dozens of elements of each in the reading view.
  mathfrac: { header: "| h |\n|---|", row: () => `| ${"$\\frac{a}{b}$ ".repeat(40)}|` },
  // Markdown links, a node with a child each, and many events.
  mdlinks: { header: "| h |\n|---|", row: () => `| ${"[l](u) ".repeat(80)}|` },
  autolinked: { header: "| h |\n|---|", row: () => `| ${"<http://a.b> ".repeat(60)}|` },
  images: { header: "| h |\n|---|", row: () => `| ${"![i](p) ".repeat(80)}|` },
  // What only the reading view's plugins make nodes of; to the parsers here they are text.
  tagsplain: { header: "| h |\n|---|", row: () => `| ${"#a ".repeat(100)}|` },
  mathplain: { header: "| h |\n|---|", row: () => `| ${"$a$ ".repeat(100)}|` },
  marksplain: { header: "| h |\n|---|", row: () => `| ${"==a== ".repeat(100)}|` },
  // Line ends and a byte order mark.
  crlfshort: { header: "| h | h |\n|---|---|", row: (i) => `| row ${i} | [[n${i}]] |`, crlf: true, bom: true },
  // A wide header over short rows: the reading view fills every row to the header's columns.
  wide100: { header: `|${"h|".repeat(100)}\n|${"-|".repeat(100)}`, row: () => "|" },
  wide20: { header: `|${"h|".repeat(20)}\n|${"-|".repeat(20)}`, row: () => "|a|" },
  // One short cell per row behind block markers: each marker is events of its own on every line (found in review: two quotes ran out of memory at the budget).
  q1one: { header: "> | h |\n> |---|", row: () => "> |a|" },
  q2one: { header: "> > | h |\n> > |---|", row: () => "> > |a|" },
  q3one: { header: "> > > | h |\n> > > |---|", row: () => "> > > |a|" },
  q5one: { header: "> > > > > | h |\n> > > > > |---|", row: () => "> > > > > |a|" },
  q3bare: { header: "> > > | h |\n> > > |---|", row: () => "> > > a" },
  lone: { header: "- | h |\n  |---|", row: () => "  |a|" },
  l2one: { header: "- - | h |\n    |---|", row: () => "    |a|" },
  lqone: { header: "- > | h |\n  > |---|", row: () => "  > |a|" },
  ql2one: { header: "> - - | h |\n>     |---|", row: () => ">     |a|" },
  fone: { header: "[^1]: | h |\n    |---|", row: () => "    |a|" },
  // Padding and content the review tried.
  tabs: { header: "|\th\t|\th\t|\th\t|\n|---|---|---|", row: (i) => `|\ta${i}\t|\tb\t|\tc\t|` },
  entity: { header: cols(2), row: (i) => `| &amp;&lt;&gt;&quot; &#${100 + (i % 20)}; | &copy; x |` },
  nopipewide: { header: Array(20).fill("h").join("|") + "\n" + Array(20).fill("-").join("|"), row: () => Array(20).fill("ab").join("|") },
  wikialias: { header: cols(3), row: (i) => `| [[Note ${i}${BS}|alias ${i}]] | [[Other${BS}|o]] | #tag |` },
  trail: { header: cols(3), row: (i) => `| a${i}${BS} | b${BS}${BS} | c   |   ` },
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

/** Where a generated table stands. */
const WRAPS = ["none", "quote", "quote2", "quote3", "list", "callout"] as const;

interface GeneratedSettings { columns: number; length: number; outer: boolean; blanks: boolean; escape: number; escapeRate: number; syntax: number; code: number; empty: number; wrap: (typeof WRAPS)[number]; units: string | null; crlf: boolean; bom: boolean }

/**
 * What a cell may be made of besides letters: words and numbers between
 * blanks, every kind of autolink literal in either case, footnote references
 * (the table's note defines them), links, wiki links, tags, formulas,
 * highlights, entities, CJK, emoji, a long word. `units` names one of them
 * for a cell made of it alone, or "mix" for a cell of all of them.
 */
const UNITS = ["a", "ab", "12", "the", "word", "WWW.a.b", "www.c.d", "HTTP://a.b", "https://a.b/c", "a@b.cc", "MAILTO:a@b.cc", "xmpp:a@b.cc", "[^1]", "[l](u)", "[[n]]", "#tag", "$x$", "==m==", "&amp;", "&#123;", "中文", "😀", "x".repeat(40)] as const;

/** How many of the first generated shapes are forced to one or two columns of 0 to 3 characters: the most rows per weight. */
const FORCED_SHORT = 8;

const SYNTAX_CHARS = "[]*_~`<&!$";
const LETTERS = "abcdefghij klmno pqrst uvwxyz";

/** The settings of generated shape `k` of `seed`. */
function settingsOf(seed: number, k: number): GeneratedSettings {
  const r = random(seed, k);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const short = k < FORCED_SHORT;
  const columns = short ? 1 + (k % 2) : 1 + Math.floor(r() * 24);
  return {
    columns,
    length: short ? Math.floor(r() * 4) : Math.floor(r() * 81),
    outer: columns === 1 || r() < 0.5,
    blanks: r() < 0.5,
    escape: Math.floor(r() * 4),
    escapeRate: pick([0, 0.2, 0.6]),
    syntax: pick([0, 0.05, 0.2, 0.5]),
    code: pick([0, 0.3]),
    empty: pick([0, 0.3, 0.7]),
    wrap: k < WRAPS.length ? WRAPS[k] : pick(WRAPS),
    // From the twelfth shape on, about half are made of units.
    units: k >= 12 && r() < 0.5 ? (r() < 0.4 ? "mix" : pick(UNITS)) : null,
    crlf: r() < 0.1,
    bom: r() < 0.1,
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
    if (s.units) {
      const count = 1 + Math.floor(r() * (s.length + 1));
      const one = () => (s.units === "mix" ? UNITS[Math.floor(r() * UNITS.length)] : s.units!);
      // A row without outer pipes must not begin like another block.
      return `c ${Array.from({ length: count }, one).join(" ")}`;
    }
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
  // The markers of the block the table stands in: on the header line, and on every line after it.
  const [first, rest] = { none: ["", ""], quote: ["> ", "> "], quote2: ["> > ", "> > "], quote3: ["> > > ", "> > > "], list: ["- ", "  "], callout: ["> ", "> "] }[s.wrap];
  return {
    crlf: s.crlf,
    bom: s.bom,
    // The references of a table's cells have their definition below it.
    after: s.units === "[^1]" || s.units === "mix" ? `${rest}\n${rest}[^1]: x` : undefined,
    before: s.wrap === "callout" ? "> [!info] Generated" : undefined,
    header: `${first}${join(Array.from({ length: s.columns }, () => "h"))}\n${rest}${join(Array.from({ length: s.columns }, () => "---"))}`,
    row: (i) => rest + join(Array.from({ length: s.columns }, (_, c) => cell(i, c))),
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
  const text = `${shape.start ?? ""}# Table\n\n${shape.before ? `${shape.before}\n` : ""}${shape.header}\n${Array.from({ length: rows }, (_, i) => shape.row(i)).join("\n")}\n${shape.after ? `${shape.after}\n` : ""}\nbelow [[Link]]\n`;
  return `${shape.bom ? "\uFEFF" : ""}${shape.crlf ? text.replace(/\n/g, "\r\n") : text}`;
}

/** What a table line weighs as the app weighs it: its row behind the markers of the blocks it stands in, and the markers. */
function lineCost(line: string, first: boolean, containers = true, columns = 0): number {
  const at = tableLineStart(line, first, containers).at;
  return tableReadCost(line, at, line.length, columns) + tableMarkerCost(line.slice(0, at));
}

/** The columns of a shape's table: the cells of its delimiter row, which every row of the reading view is filled to. */
function columnsOf(shape: Shape): number {
  const delimiter = shape.header.split("\n")[1];
  return tableRowParts(delimiter, tableLineStart(delimiter, false).at, delimiter.length).cells;
}

/** The parts of a table's weight, summed; `markers` is what the markers weigh beyond their characters at a marker weight of one. */
export type Parts = { rows: number; chars: number; cells: number; syntax: number; markers: number; literals: number; words: number; references: number; links: number; maths: number };

/** What the markers of `prefix` count, beyond their characters (`tableMarkerCost` at a marker weight of one). */
const markersOf = (prefix: string): number => (prefix.match(/>/g)?.length ?? 0) + (prefix.replace(/>[ \t]?/g, "").length > 0 ? 1 : 0);

/** The parts of a shape's header and first `rows` rows, summed: what its table's weight is made of, under any weights. */
export function tableParts(name: string, rows: number): Parts {
  const shape = shapeOf(name);
  const sum = { rows: 0, chars: 0, cells: 0, syntax: 0, markers: 0, literals: 0, words: 0, references: 0, links: 0, maths: 0 };
  const header = shape.header.split("\n")[0];
  const containers = !opensNoContainers(shapeTable(name, 0));
  const columns = columnsOf(shape);
  for (const [i, row] of [header, ...Array.from({ length: rows }, (_, i) => shape.row(i))].entries()) {
    const at = tableLineStart(row, i === 0, containers).at;
    const parts = tableRowParts(row, at, row.length);
    sum.rows += 1;
    sum.chars += parts.chars + at;
    sum.markers += markersOf(row.slice(0, at));
    sum.cells += Math.max(parts.cells, columns);
    sum.syntax += parts.syntax;
    sum.literals += parts.literals;
    sum.words += parts.words;
    sum.references += parts.references;
    sum.links += parts.links;
    sum.maths += parts.maths;
  }
  return sum;
}

/** The weight of `parts` under a set of weights; what the reading view's own plugins weigh (tags, formulas, highlights) is calibrated in the desktop app and left out here. */
const weigh = (parts: Parts, row: number, cell: number, syntax: number, marker = 0, literal = 0, word = 0, reference = 0, link = 0, math = 0) =>
  row * parts.rows + parts.chars + cell * parts.cells + syntax * parts.syntax + marker * parts.markers + literal * parts.literals + word * parts.words + reference * parts.references + link * parts.links + math * parts.maths;

/** The rows of a shape whose table weighs `target` by the constants as they stand. */
function rowsAt(name: string, target: number): number {
  const shape = shapeOf(name);
  const header = shape.header.split("\n")[0];
  const containers = !opensNoContainers(shapeTable(name, 0));
  const columns = columnsOf(shape);
  let weight = lineCost(header, true, containers);
  let rows = 0;
  for (;;) {
    const row = shape.row(rows);
    const next = weight + lineCost(row, false, containers, columns);
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
  for (const parse of ["index", "tree", "reader"]) {
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

/**
 * `--limits <file>` takes the limits of the shapes a calibration log already
 * holds (its `limit` lines) and searches only the others: the limit search is
 * what takes the time.
 */
function calibrate(args: string[]): void {
  const known = new Map<string, number>();
  if (args.includes("--limits")) {
    for (const m of readFileSync(args[args.indexOf("--limits") + 1], "utf8").matchAll(/^limit\s+(\S+)\s+(\d+) rows/gm)) known.set(m[1], Number(m[2]));
  }
  const limits: Record<string, Parts> = {};
  for (const name of Object.keys(SHAPES)) {
    const rows = known.get(name) ?? limitOf(name);
    limits[name] = tableParts(name, rows);
    console.log(`limit    ${name.padEnd(10)} ${String(rows).padStart(7)} rows under ${HEAP_MB} MB${known.has(name) ? " (from the log)" : ""}`);
  }
  // Generated shapes an earlier search measured (their limits in the log) count as fixed ones.
  for (const [name, rows] of known) {
    if (!name.startsWith("gen:")) continue;
    limits[name] = tableParts(name, rows);
    console.log(`limit    ${name.padEnd(10)} ${String(rows).padStart(7)} rows under ${HEAP_MB} MB (from the log)`);
  }
  // `--search <n>`: n generated shapes of a seed of their own, each measured
  // like a fixed one — so that the weights are chosen over what a search
  // finds, not only over the shapes someone thought of. Each costs a limit
  // search (about a minute).
  if (args.includes("--search")) {
    const count = Number(args[args.indexOf("--search") + 1]);
    const searchSeed = args.includes("--search-seed") ? Number(args[args.indexOf("--search-seed") + 1]) : Date.now() % 1_000_000;
    console.log(`search   ${count} generated shapes, seed ${searchSeed}`);
    for (let k = 0; k < count; k++) {
      const name = `gen:${searchSeed}:${k}`;
      const rows = limitOf(name);
      limits[name] = tableParts(name, rows);
      console.log(`limit    ${name.padEnd(10)} ${String(rows).padStart(7)} rows under ${HEAP_MB} MB  ${JSON.stringify(settingsOf(searchSeed, k))}`);
    }
  }
  const short = tableParts("short", 1000);
  // For each set of weights the budget is nine tenths of the lightest limit
  // among the shapes without block markers; keep the set that leaves a word
  // and a link the most rows. Then the marker weight: the least that lifts
  // every shape behind markers to the budget / 0.9 as well.
  let best = { row: 0, cell: 0, syntax: 0, budget: 0, shortRows: 0 };
  // The base set: no block markers, no literals, no references, and few starts of words (a word and a link has three a row; a row of a hundred numbers a hundred).
  const plain = Object.values(limits).filter((parts) => parts.markers === 0 && parts.literals === 0 && parts.references === 0 && parts.links === 0 && parts.maths === 0 && parts.words <= 10 * parts.rows);
  // Wide enough that the best set lies inside it: the weights are relative to one per character.
  for (let row = 0; row <= 1_000; row += 8) {
    for (let cell = 0; cell <= 300; cell += 3) {
      for (let syntax = 0; syntax <= 150; syntax += 2) {
        let lightest = Infinity;
        for (const parts of plain) lightest = Math.min(lightest, weigh(parts, row, cell, syntax));
        const budget = 0.9 * lightest;
        const shortRows = (budget / weigh(short, row, cell, syntax)) * 1000;
        if (shortRows > best.shortRows) best = { row, cell, syntax, budget, shortRows };
      }
    }
  }
  // Then the weights of the other parts, each the least that lifts every
  // shape still short of the budget / 0.9: first those a word and a link has
  // none of — references, links, formulas, literals —, then words (a row of
  // numbers is short by its words), block markers last, so that a table in a
  // quote or a callout is not made small for what its words cost
  // (2026-11-13: in the other order 1 430 rows of a word and a link in a
  // quote at the budget, in this one 3 305).
  const extra = { reference: 0, link: 0, math: 0, word: 0, marker: 0, literal: 0 };
  const current = (parts: Parts) => weigh(parts, best.row, best.cell, best.syntax, extra.marker, extra.literal, extra.word, extra.reference, extra.link, extra.math);
  for (const [key, count] of [["reference", (parts: Parts) => parts.references], ["link", (parts: Parts) => parts.links], ["math", (parts: Parts) => parts.maths], ["literal", (parts: Parts) => parts.literals], ["word", (parts: Parts) => parts.words], ["marker", (parts: Parts) => parts.markers]] as const) {
    let need = 0;
    for (const parts of Object.values(limits)) if (count(parts) > 0) need = Math.max(need, Math.ceil((best.budget / 0.9 - current(parts)) / count(parts)));
    extra[key] = need;
  }
  const { reference, link, math, word, marker, literal } = extra;
  const final = (parts: Parts) => weigh(parts, best.row, best.cell, best.syntax, marker, literal, word, reference, link, math);
  const budget = Math.floor(best.budget / 10_000) * 10_000;
  console.log(`weights  row ${best.row}, cell ${best.cell}, syntax ${best.syntax}, marker ${marker}, literal ${literal}, word ${word}, reference ${reference}, link ${link}, math ${math}: proposed budget ${budget} (a word and a link: about ${Math.round((best.budget / final(short)) * 1000)} rows)`);
  for (const [name, parts] of Object.entries(limits)) console.log(`         ${name.padEnd(10)} limit weighs ${(final(parts) / budget).toFixed(2)} x the budget`);
}

/**
 * The shapes this budget reads as a table at more rows than the scan of
 * `origin/main` does: `git show` gives that scan, read from a file of its
 * own. `null` where git or the branch is not at hand.
 */
async function mainComparison(names: string[]): Promise<string[] | null> {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  let source: string;
  try {
    source = execFileSync("git", ["show", "origin/main:packages/core/src/inlineParseBudget.ts"], { cwd: CORE, encoding: "utf8" });
  } catch {
    console.log("main     origin/main not at hand: no comparison");
    return null;
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), "table-budget-main-")), "inlineParseBudget.ts");
  writeFileSync(file, source);
  const main = (await import(pathToFileURL(file).href)) as { overBudgetInlineRanges: (text: string) => unknown[] };
  const beyond: string[] = [];
  for (const name of names) {
    const ours = rowsAt(name, TABLE_READ_BUDGET);
    // Where main begins to read the table as written: the fewest rows it puts in a range.
    let lo = 0;
    let hi = Math.max(1, ours);
    const bounded = (rows: number) => main.overBudgetInlineRanges(shapeTable(name, rows)).length > 0;
    if (!bounded(hi)) continue;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bounded(mid)) hi = mid;
      else lo = mid;
    }
    if (ours >= hi) beyond.push(`${name} (main ${hi}, here ${ours})`);
  }
  return beyond;
}

async function check(args: string[]): Promise<boolean> {
  const at = (flag: string, fallback: number) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
  const seed = at("--seed", 20261112);
  const generated = at("--generated", 36);
  const started = performance.now();
  let all = true;
  console.log(`check    budget ${TABLE_READ_BUDGET}, row ${TABLE_ROW_WEIGHT}, cell ${TABLE_CELL_WEIGHT}, syntax ${TABLE_SYNTAX_WEIGHT}, marker ${TABLE_MARKER_WEIGHT}, literal ${TABLE_LITERAL_WEIGHT}, word ${TABLE_WORD_WEIGHT}, reference ${TABLE_REFERENCE_WEIGHT}, link ${TABLE_LINK_WEIGHT}, math ${TABLE_MATH_WEIGHT}, ${HEAP_MB} MB; ${Object.keys(SHAPES).length} fixed shapes, ${generated} generated (seed ${seed})`);
  // What the generated shapes cover, axis by axis.
  const covered = new Map<string, Set<string>>();
  for (let k = 0; k < generated; k++) {
    const s = settingsOf(seed, k);
    const values: Record<string, string> = {
      columns: s.columns <= 2 ? "1-2" : s.columns <= 8 ? "3-8" : s.columns <= 16 ? "9-16" : "17-24",
      length: s.length <= 3 ? "0-3" : s.length <= 20 ? "4-20" : "21-80",
      outer: String(s.outer),
      blanks: String(s.blanks),
      escape: s.escapeRate === 0 ? "none" : `${s.escape}x\\`,
      syntax: String(s.syntax),
      code: String(s.code > 0),
      empty: String(s.empty),
      wrap: s.wrap,
      units: s.units ?? "letters",
      crlf: String(s.crlf),
      bom: String(s.bom),
    };
    for (const [axis, value] of Object.entries(values)) {
      if (!covered.has(axis)) covered.set(axis, new Set());
      covered.get(axis)!.add(value);
    }
  }
  console.log(`covered  ${[...covered].map(([axis, values]) => `${axis}: ${[...values].sort().join(" ")}`).join("; ")}`);
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
  // Against the scan of `origin/main`: where it reads a table as written and
  // this one reads it as a table, the table at this budget must pass above.
  const beyond = await mainComparison(names);
  if (beyond !== null) console.log(`main     ${beyond.length} of ${names.length} shapes are read as a table here beyond the size main reads as written${beyond.length ? `: ${beyond.slice(0, 12).join(", ")}` : ""}; each passes at the budget above or the check failed`);
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
  // The reading view's parser (GFM without the properties block, MarkdownReader.tsx) and its HTML tree, which fills every row to the header's columns.
  reader: (text: string) => {
    // With math, as the reading view runs it: remark-math in the parse, KaTeX for the page.
    if (HAS_MATH.test(text)) {
      const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath as never).use(remarkRehype as never).use(rehypeKatex as never);
      const tree = processor.parse(text);
      processor.runSync(tree);
      return tree;
    }
    const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
    toHast(tree);
    return tree;
  },
};

/** The reading view as the app runs it: weighed for its own parser, then the same two steps. */
function boundedReader(text: string) {
  return unbounded.reader(boundMarkdownForParse(text, READER_READING).text);
}

function child(name: string, rows: number, parse: string, bounded: boolean): void {
  const text = shapeTable(name, rows);
  const started = performance.now();
  const tree = (bounded
    ? parse === "index" ? parseMarkdownAst(text, { preserveObsidianSyntax: true }) : parse === "reader" ? boundedReader(text) : parseMarkdownTree(text)
    : unbounded[parse as keyof typeof unbounded](text)) as { children?: Array<{ type: string }> };
  // A table the budget reads as written costs what plain text costs: only a table read as a table counts, in whatever block it stands.
  const hasTable = (node: { type: string; children?: unknown[] } | undefined): boolean =>
    !!node && (node.type === "table" || (node.children ?? []).some((child) => hasTable(child as { type: string; children?: unknown[] })));
  if (!hasTable(tree as { type: string; children?: unknown[] })) throw new Error(`not read as a table: ${tree.children?.map((node) => node.type).join(", ")}`);
  console.log(`ok ${Math.round(performance.now() - started)}`);
}

/** `perf:tables -- --calibrate` and `--check` (`many-tables.ts` hands them here). */
/**
 * `--hunt <n> [--minutes <m>] [--seed <s>]`: n generated tables of a seed
 * drawn anew (or given), each at the budget, read by every parser under the
 * capped heap — what the performance workflow runs on every push, so that the
 * next shape the weight misses is found by a run, not by a review. Stops
 * after m minutes; a table that does not pass is printed with its seed, its
 * number and its settings, and the run fails.
 */
function hunt(args: string[]): boolean {
  const at = (flag: string, fallback: number) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
  const count = at("--hunt", 50);
  const minutes = at("--minutes", 20);
  const seed = at("--seed", Date.now() % 1_000_000);
  const started = performance.now();
  let tried = 0;
  const failed: string[] = [];
  console.log(`hunt     ${count} generated tables, seed ${seed}, at most ${minutes} min; budget ${TABLE_READ_BUDGET}`);
  for (let k = 0; k < count && performance.now() - started < minutes * 60_000; k++) {
    const name = `gen:${seed}:${k}`;
    const rows = rowsAt(name, TABLE_READ_BUDGET);
    const run = passes(name, rows, true);
    tried++;
    if (!run.ok) {
      failed.push(name);
      console.log(`FAIL     ${name} at ${rows} rows: ${run.why}; ${JSON.stringify(settingsOf(seed, k))}; first row ${JSON.stringify(shapeOf(name).row(0).slice(0, 200))}`);
    }
  }
  console.log(`hunt     ${tried} tables in ${Math.round((performance.now() - started) / 1000)} s: ${failed.length ? `${failed.length} FAILED (${failed.join(", ")}) — take each into SHAPES and calibrate anew` : "every table passes"}`);
  return failed.length === 0;
}

export async function runTableBudget(args: string[]): Promise<void> {
  if (args.includes("--hunt")) {
    if (!hunt(args)) process.exitCode = 1;
    return;
  }
  if (args.includes("--calibrate")) calibrate(args);
  // `--no-check`: the calibration alone, for constants not yet set.
  if (args.includes("--no-check")) return;
  if (!(await check(args))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--child" || args[0] === "--child-unbounded") child(args[1], Number(args[2]), args[3], args[0] === "--child");
  else runTableBudget(args);
}
