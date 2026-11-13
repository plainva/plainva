import { describe, expect, it } from "vitest";
import { within } from "./helpers/timeBudget.js";
import {
  boundMarkdownForParse,
  exceedsInlineParseBudget,
  INLINE_PARSE_BUDGET,
  MAX_CLOSING_BRACKETS,
  inlineParseCost,
  overBudgetInlineRanges,
  restoreBoundedTree,
  restoreBoundedValue,
  TABLE_CELL_WEIGHT,
  TABLE_MARKER_WEIGHT,
  tableMarkerCost,
  TABLE_READ_BUDGET,
  TABLE_ROW_WEIGHT,
  tableLineStart,
  TABLE_SYNTAX_WEIGHT,
  tableReadCost,
  tableRowParts,
} from "../src/inlineParseBudget.ts";
import { parseCommonMarkTree, parseMarkdownAst, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { analyzeNoteOutline, analyzeNoteSource } from "../src/noteSource.ts";
import { remarkWikiLinks } from "../src/wikiLinkSyntax.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * The parse budget (open-items plan 3.133 no. 4): a line of 100 000 `]` held
 * the reading view and the note source for minutes, because the Markdown
 * parser looks back over a whole paragraph at each `]`, `*`, `_` and `~`. The
 * same work came from short lines without a blank line between them, and a
 * table of many rows holds hundreds of megabytes while it is read (L13).
 * A stretch over the budget is read as written; every
 * other part of the note, and every note a person writes, is read as before.
 *
 * The time limits are generous on purpose: each input below took the parser
 * well over a minute before the budget (measured: 100 000 `]` in one line,
 * minutes; 16 000 in lines of 80, five seconds — the work grows with the
 * square), and takes some tens of milliseconds with it.
 */

const SECONDS = 1000;

function textsOf(node: MarkdownTreeNode, into: string[] = []): string[] {
  if (typeof node.value === "string") into.push(node.value);
  for (const child of node.children ?? []) textsOf(child, into);
  return into;
}

function typesOf(node: MarkdownTreeNode, into: string[] = []): string[] {
  into.push(node.type);
  for (const child of node.children ?? []) typesOf(child, into);
  return into;
}

const LONG_LINE = "]".repeat(100_000);
const SHORT_LINES = Array.from({ length: 1_000 }, () => "]".repeat(80)).join("\n");
const EMPHASIS_RUN = "*a".repeat(50_000);

describe("the inline parse budget", () => {
  it("reads a line of 100 000 `]` in a moment, and the note around it as before", () => {
    const note = `# Title\n\nBefore [[Kept]] and *em*.\n\n${LONG_LINE}\n\n## After\n\nA [[Link]] behind it.\n`;
    const tree = within(5 * SECONDS, () => parseMarkdownTree(note));
    const blocks = (tree.children ?? []).map((node) => node.type);
    expect(blocks).toEqual(["heading", "paragraph", "paragraph", "heading", "paragraph"]);
    // The line is text, character for character, at its place.
    const line = tree.children![2];
    expect(textsOf(line).join("")).toBe(LONG_LINE);
    expect(note.slice(line.position!.start.offset, line.position!.end.offset)).toBe(LONG_LINE);
    // What stands around it is Markdown as ever.
    expect(typesOf(tree.children![1])).toContain("wikiLink");
    expect(typesOf(tree.children![1])).toContain("emphasis");
    expect(typesOf(tree.children![4])).toContain("wikiLink");
  }, 120 * SECONDS);

  it("bounds a paragraph of short lines the same way: the work belongs to the paragraph", () => {
    const tree = within(5 * SECONDS, () => parseMarkdownTree(`${SHORT_LINES}\n\nafter *em*`));
    expect(textsOf(tree.children![0]).join("")).toBe(SHORT_LINES);
    expect(typesOf(tree.children![1])).toContain("emphasis");
  }, 120 * SECONDS);

  it("bounds emphasis runs, the outline and the journal's reading of the note", () => {
    const note = `# One\n\n${EMPHASIS_RUN}\n\n## Two\n\ntext ^block\n`;
    within(10 * SECONDS, () => {
      parseMarkdownAst(note, { preserveObsidianSyntax: true });
      analyzeNoteSource(note);
      analyzeNoteOutline(note);
      parseCommonMarkTree(note);
    });
    const source = analyzeNoteSource(note);
    expect(source.headings.map((h) => h.text)).toEqual(["One", "Two"]);
    expect(source.blocks.map((b) => b.id)).toEqual(["block"]);
  }, 240 * SECONDS);

  it("weighs a table by its characters, its cells and its inline syntax", () => {
    const row = "| [[a]] | *b* |";
    // One row, 15 characters, 2 cells, 4 brackets and 2 stars.
    expect(tableReadCost(row, 0, row.length)).toBe(TABLE_ROW_WEIGHT + 15 + 2 * TABLE_CELL_WEIGHT + 6 * TABLE_SYNTAX_WEIGHT);
    // A row costs on its own: one short cell is still a row (the review's `|a|`, 18 000 of them).
    expect(tableReadCost("|a|", 0, 3)).toBe(TABLE_ROW_WEIGHT + 3 + TABLE_CELL_WEIGHT);
    expect(TABLE_ROW_WEIGHT).toBeGreaterThan(0);
    expect(tableReadCost(`x${row}x`, 1, row.length + 1)).toBe(tableReadCost(row, 0, row.length));
    // Each block marker in front of a line is events of its own on every line: two quotes around `|a|` ran out of memory at the budget.
    expect(TABLE_MARKER_WEIGHT).toBeGreaterThan(0);
    expect(tableMarkerCost("")).toBe(0);
    expect(tableMarkerCost("> > ")).toBe(4 + 2 * TABLE_MARKER_WEIGHT);
    expect(tableMarkerCost("  ")).toBe(2 + TABLE_MARKER_WEIGHT);
    expect(tableMarkerCost("- > ")).toBe(4 + 2 * TABLE_MARKER_WEIGHT);
    const deep = `> > | h |\n> > |---|\n${Array.from({ length: Math.ceil(TABLE_READ_BUDGET / (tableReadCost("|a|", 0, 3) + tableMarkerCost("> > "))) + 1 }, () => "> > |a|").join("\n")}\n`;
    expect(overBudgetInlineRanges(deep)).toHaveLength(1);
  });

  it("counts a row's cells the way the table parser does", () => {
    const parts = (row: string) => {
      const { cells, boundaries } = tableRowParts(row, 0, row.length);
      return { cells, boundaries };
    };
    // A pipe behind one backslash is in the cell; behind two, the backslash is escaped and the pipe a boundary; behind three, escaped again.
    expect(parts("|a\\|b|")).toEqual({ cells: 1, boundaries: 2 });
    expect(parts("|a\\\\|b|")).toEqual({ cells: 2, boundaries: 3 });
    expect(parts("|a\\\\\\|b|")).toEqual({ cells: 1, boundaries: 2 });
    // Also inside a code span.
    expect(parts("| `a\\\\|b` |")).toEqual({ cells: 2, boundaries: 3 });
    // Without outer pipes a row has one cell more than boundaries.
    expect(parts("a | b | c")).toEqual({ cells: 3, boundaries: 2 });
    expect(parts("a|b")).toEqual({ cells: 2, boundaries: 1 });
    // An empty cell between two boundaries is a cell; blanks before the first and after the last boundary are not.
    expect(parts("| | a |")).toEqual({ cells: 2, boundaries: 3 });
    expect(parts("|||")).toEqual({ cells: 2, boundaries: 3 });
    // A `>` is content here: what is a quote marker is decided once, by tableLineStart.
    const startOf = (line: string, first: boolean) => {
      const { depth, at } = tableLineStart(line, first);
      return { depth, at };
    };
    expect(parts("\\>a | b")).toEqual({ cells: 2, boundaries: 1 });
    expect(parts("> | a | b |")).toEqual({ cells: 3, boundaries: 3 });
    expect(startOf(">a | b", true)).toEqual({ depth: 1, at: 1 });
    expect(startOf("\\>a | b", true)).toEqual({ depth: 0, at: 0 });
    expect(startOf("- > | a |", true)).toEqual({ depth: 1, at: 4 });
    expect(startOf("  > | a |", false)).toEqual({ depth: 1, at: 4 });
    expect(startOf("[^1]: | a |", true)).toEqual({ depth: 0, at: 6 });
    // A list marker opens a block on a table's first line only.
    expect(startOf("- | a |", false)).toEqual({ depth: 0, at: 0 });
    // What the table's later lines must repeat: the item's content column, a footnote's four blanks, each quote marker.
    expect(tableLineStart("- | a |", true).prefix).toEqual([2]);
    expect(tableLineStart("10.  | a |", true).prefix).toEqual([5]);
    expect(tableLineStart("[^1]: | a |", true).prefix).toEqual([4]);
    expect(tableLineStart("> - | a |", true).prefix).toEqual([-1, 2]);
    // The parser reads `|a\\|a\\|a|` as three cells, as the review found.
    const parsed = parseMarkdownTree("|h|h|h|\n|-|-|-|\n|a\\\\|a\\\\|a|\n");
    expect(parsed.children![0].children![1].children).toHaveLength(parts("|a\\\\|a\\\\|a|").cells);
  });

  // Rows of a word and a link, added until the table is at the budget (L13):
  // about 5 000 of them. Until GFM tables 2.1.2 the rule was rows times
  // length, for a parse that grew with the square of the cells, and a table
  // of more than about 2 500 such rows was read as written — no table, and
  // none of its links in the index.
  const HEADER = "| a | b |";
  const atBudget = (() => {
    const rows: string[] = [];
    // The header row weighs in; the delimiter row holds no content.
    let cost = tableReadCost(HEADER, 0, HEADER.length);
    for (let i = 0; ; i++) {
      const row = `| row ${i} | [[n${i}]] |`;
      if (cost + tableReadCost(row, 0, row.length) > TABLE_READ_BUDGET) return { rows, next: row };
      rows.push(row);
      cost += tableReadCost(row, 0, row.length);
    }
  })();
  const noteOf = (rows: string[]) => `# Data\n\n${[HEADER, "|---|---|", ...rows].join("\n")}\n\nbelow [[Link]]\n`;

  it("reads a table at its budget as a table, with the link of every cell", () => {
    expect(atBudget.rows.length).toBeGreaterThan(4_000);
    const note = noteOf(atBudget.rows);
    expect(overBudgetInlineRanges(note)).toEqual([]);
    const ast = parseMarkdownAst(note, { preserveObsidianSyntax: true });
    expect(ast.children.map((node) => node.type)).toEqual(["heading", "table", "paragraph"]);
    expect(extractLinksAndTags(ast).links.map((link) => link.target)).toEqual([...atBudget.rows.map((_, i) => `n${i}`), "Link"]);
  }, 240 * SECONDS);

  it("reads a table one row over its budget as written, in bounded time and memory, and the note around it as before", () => {
    const rows = [...atBudget.rows, atBudget.next];
    const note = noteOf(rows);
    const table = [HEADER, "|---|---|", ...rows].join("\n");
    const ranges = overBudgetInlineRanges(note);
    expect(ranges).toHaveLength(1);
    expect(note.slice(ranges[0].from, ranges[0].to)).toBe(table);
    const tree = within(5 * SECONDS, () => parseMarkdownTree(note));
    expect(tree.children!.map((node) => node.type)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(textsOf(tree.children![1]).join("")).toBe(table);
    // What the parse keeps of it is a paragraph of text — no cell, no link: a
    // handful of nodes where the table held more than 100 000.
    expect(typesOf(tree.children![1]).length).toBeLessThan(10);
    expect(typesOf(tree.children![2])).toContain("wikiLink");
  }, 240 * SECONDS);

  it("weighs a table wherever one can stand, and reads one over its budget as written with its quote or list around it", () => {
    // Sixteen one-character cells, over the budget: in a quote or a list item
    // the table was not weighed at all, and its parse ran out of memory
    // (found in review; the rows-times-length rule had the same hole).
    const dense = (first: string, rest: string, rows: number) => [`${first}|${"h|".repeat(16)}`, `${rest}|${"-|".repeat(16)}`, ...Array.from({ length: rows }, () => `${rest}|${"a|".repeat(16)}`)];
    const textsIn = (node: MarkdownTreeNode): string => textsOf(node).join("");
    const placements: Array<[string, string, string, string, string[]]> = [
      ["a quote", "> ", "> ", "", ["blockquote"]],
      ["a callout", "> ", "> ", "> [!note] Numbers\n", ["blockquote"]],
      ["a list item", "- ", "  ", "", ["list", "listItem"]],
      ["a quote in a list", "- > ", "  > ", "", ["list", "listItem", "blockquote"]],
      ["a list in a quote", "> - ", ">   ", "", ["blockquote", "list", "listItem"]],
      ["a footnote", "[^1]: ", "    ", "", ["footnoteDefinition"]],
      ["behind a paragraph line", "", "", "A line before it\n", []],
    ];
    for (const [where, first, rest, before, containers] of placements) {
      const row = `|${"a|".repeat(16)}`;
      const lines = dense(first, rest, Math.ceil((1.5 * TABLE_READ_BUDGET) / tableReadCost(row, 0, row.length)));
      const note = `# T\n\n${before}${lines.join("\n")}\n\nbelow [[Link]]\n`;
      const ranges = overBudgetInlineRanges(note);
      expect(ranges, where).toHaveLength(1);
      // The range is the table's lines behind the markers of the first line: the markers stay as written.
      const tableStart = note.indexOf(lines[0]) + first.length;
      expect(ranges[0], where).toEqual({ from: tableStart, to: note.lastIndexOf(lines[lines.length - 1]) + lines[lines.length - 1].length });
      const tree = parseMarkdownTree(note);
      let node = tree.children![1];
      for (const container of containers) {
        expect(node.type, where).toBe(container);
        node = node.children![0];
      }
      expect(typesOf(tree.children![1]), where).not.toContain("table");
      // What the parse gives back is what was written, behind the markers.
      const written = lines.map((line, i) => line.slice(tableLineStart(line, i === 0).at)).join("\n");
      expect(textsIn(tree.children![1]), where).toContain(written);
      expect(typesOf(tree.children![2]), where).toContain("wikiLink");
    }
    // A table in a quote under its budget stays a table.
    const small = `# T\n\n${dense("> ", "> ", 20).join("\n")}\n`;
    expect(overBudgetInlineRanges(small)).toEqual([]);
    expect(typesOf(parseMarkdownTree(small))).toContain("table");
  }, 240 * SECONDS);

  it("reads a long table in time linear in its cells", () => {
    // 4 000 rows take about half a second; the budget leaves five times that,
    // scaled to a slower core. Quadratic, as before GFM tables 2.1.2, they took
    // seconds.
    const note = noteOf(Array.from({ length: 4_000 }, (_, i) => `| row ${i} | [[n${i}]] |`));
    const tree = within(3 * SECONDS, () => parseMarkdownTree(note));
    expect(tree.children![1].type).toBe("table");
  }, 240 * SECONDS);

  it("leaves the links of a stretch read as written out of the index's reading", () => {
    const stretch = `[[Inside]] ${"x]".repeat(20_000)}`;
    const ast = parseMarkdownAst(`[[Before]]\n\n${stretch}\n\n[[After]]\n`, { preserveObsidianSyntax: true });
    expect(extractLinksAndTags(ast).links.map((link) => link.target)).toEqual(["Before", "After"]);
  });

  it("keeps every place of a text that starts with a byte order mark", () => {
    const mark = String.fromCharCode(0xfeff);
    const note = `${mark}# T\n\n${LONG_LINE}\n\n## U\n`;
    const tree = parseMarkdownTree(note);
    const line = tree.children![1];
    expect(note.slice(line.position!.start.offset, line.position!.end.offset)).toBe(LONG_LINE);
    expect(textsOf(line).join("")).toBe(LONG_LINE);
    const last = tree.children![2];
    expect(note.slice(last.position!.start.offset, last.position!.end.offset)).toBe("## U");
  }, 120 * SECONDS);
});

describe("every note a person writes is read as before", () => {
  const notes: Array<[string, string]> = [
    ["a long paragraph with links and emphasis", Array.from({ length: 400 }, (_, i) => `Sentence ${i} with a [[Link ${i}]], *some* **bold** and a snake_case_name.`).join(" ")],
    ["a table of 2 000 rows with links", ["| a | b |", "|---|---|", ...Array.from({ length: 2_000 }, (_, i) => `| [[n${i}]] | **${i}** |`)].join("\n")],
    ["fenced code without a blank line", "```python\n" + Array.from({ length: 4_000 }, (_, i) => `self.__value_${i} = kwargs["__x_${i}__"] * args[${i}]`).join("\n") + "\n```"],
    ["a list of 3 000 items", Array.from({ length: 3_000 }, (_, i) => `- [ ] task ${i} with [[link]] and *em*`).join("\n")],
    ["a line of 50 000 characters without markup", "word ".repeat(10_000)],
    ["a picture as data, 40 000 characters", `![x](data:image/png;base64,${"A".repeat(40_000)})`],
  ];
  it.each(notes)("%s", (_name, note) => {
    expect(overBudgetInlineRanges(note)).toEqual([]);
    expect(boundMarkdownForParse(note).text).toBe(note);
  });
});

describe("what counts as one paragraph", () => {
  const costly = Array.from({ length: 1_000 }, () => "]".repeat(80));

  it("measures lines without a blank line between them together, and a blank line splits them", () => {
    expect(overBudgetInlineRanges(costly.join("\n"))).toHaveLength(1);
    expect(overBudgetInlineRanges(costly.join("\n\n"))).toEqual([]);
    // A line of blanks and tabs is blank to the parser as well.
    expect(overBudgetInlineRanges(costly.join("\n \t\n"))).toEqual([]);
  });

  it("begins a new stretch at each heading and list item, and only where a parser does", () => {
    const item = (marker: string) => costly.slice(0, 2).map((line) => `${marker} ${line}`);
    // Each item is its own paragraph: a long list costs nothing.
    expect(overBudgetInlineRanges(Array.from({ length: 1_000 }, () => item("-")).flat().join("\n"))).toEqual([]);
    expect(overBudgetInlineRanges(Array.from({ length: 1_000 }, (_, i) => `${i + 1}. ${costly[0]}`).join("\n"))).toEqual([]);
    expect(overBudgetInlineRanges(Array.from({ length: 1_000 }, () => `> - [ ] ${costly[0]}`).join("\n"))).toEqual([]);
    expect(overBudgetInlineRanges(Array.from({ length: 1_000 }, () => `# ${costly[0]}`).join("\n"))).toEqual([]);
    expect(overBudgetInlineRanges(Array.from({ length: 500 }, () => `- a\n  - ${costly[0]}`).join("\n"))).toEqual([]);
    // Continuation lines of an item belong to its paragraph.
    expect(overBudgetInlineRanges(`- a\n${costly.join("\n")}`)).toHaveLength(1);
    // An ordered item interrupts a paragraph only when it starts at 1.
    expect(overBudgetInlineRanges(`text\n${costly.map((line, i) => `${i + 2}. ${line}`).join("\n")}`)).toHaveLength(1);
    // Four blanks in front make no item behind a paragraph, and no heading.
    expect(overBudgetInlineRanges(`text\n${costly.map((line) => `    - ${line}`).join("\n")}`)).toHaveLength(1);
    expect(overBudgetInlineRanges(`text\n${costly.map((line) => `    # ${line}`).join("\n")}`)).toHaveLength(1);
    // A nested ordered list that does not start at 1 continues the item's paragraph.
    expect(overBudgetInlineRanges(`- a\n${costly.map((line, i) => `  ${i + 2}. ${line}`).join("\n")}`)).toHaveLength(1);
    // Outside the quote a deeper item is lazy text of the paragraph in it.
    expect(overBudgetInlineRanges(`> - a\n${costly.map((line) => `    - ${line}`).join("\n")}`)).toHaveLength(1);
    // An empty item opens nothing inside a paragraph.
    expect(overBudgetInlineRanges(costly.map((line) => `${line}\n+`).join("\n"))).toHaveLength(1);
  });

  it("leaves fenced code out, and only fences every reader agrees on", () => {
    expect(overBudgetInlineRanges("```\n" + costly.join("\n") + "\n```\n")).toEqual([]);
    expect(overBudgetInlineRanges("~~~~\n" + costly.join("\n") + "\n~~~~\n")).toEqual([]);
    // Indented by a tab, or by four blanks, it is indented code, and the lines behind it a paragraph.
    expect(overBudgetInlineRanges("\t```\n" + costly.join("\n"))).toHaveLength(1);
    expect(overBudgetInlineRanges("    ```\n" + costly.join("\n"))).toHaveLength(1);
    // A backtick fence's info string has no backtick: this is inline code.
    expect(overBudgetInlineRanges("```x```\n" + costly.join("\n"))).toHaveLength(1);
    // A fence opened in a list item ends with the item.
    expect(overBudgetInlineRanges("- a\n  ```\nb\n" + costly.join("\n"))).toHaveLength(1);
    // A shorter run does not close a fence.
    expect(overBudgetInlineRanges("````\n```\n" + costly.join("\n"))).toEqual([]);
  });

  it("measures each table row alone, and only a table every reader agrees on", () => {
    const rows = costly.map((row) => `| ${row.slice(0, 20)} |`);
    expect(overBudgetInlineRanges(["| a |", "|---|", ...rows].join("\n"))).toEqual([]);
    // A header with a different number of cells: no table, one paragraph.
    expect(overBudgetInlineRanges(["| a | b | c |", "|---|---|", ...rows].join("\n"))).toHaveLength(1);
    // A delimiter row without a pipe makes a heading underline, no table.
    expect(overBudgetInlineRanges(["a", "---", ...costly].join("\n"))).toHaveLength(1);
    // A line without a pipe under a table is one of its rows, as the parser reads it: weighed with the table.
    const pipeless = ["| a |", "|---|", "| b |", ...costly].join("\n");
    expect(overBudgetInlineRanges(pipeless)).toEqual([{ from: 0, to: pipeless.length }]);
    // A header that starts a list item is no table.
    expect(overBudgetInlineRanges(["- a | b", "--|--", ...rows].join("\n"))).toHaveLength(1);
    // A single row over the budget is that row.
    const row = `| ${"]".repeat(20_000)} |`;
    const text = ["| a |", "|---|", "| b |", row, "| c |"].join("\n");
    const ranges = overBudgetInlineRanges(text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(row);
  });
});

describe("the measure and the stand-ins", () => {
  it("costs how far each closer looks back: to its opener, or to the start", () => {
    // `]` at 1 finds no `[`; `*` at 3 can close and finds no opener; `_` inside a word neither opens nor closes; `~` at 7 finds none.
    expect(inlineParseCost("a]b*c_d~e")).toBe(1 + 3 + 7);
    // Written Markdown: every closer finds its opener close by (`]]` 2 and 4, `*` 2, `__` 3, `~~` 3, `]` 2).
    expect(inlineParseCost("[[a]] *b* __c__ ~~d~~ [e](f)")).toBe(2 + 4 + 2 + 3 + 3 + 2);
    // A closer escaped is none; `*` between blanks neither opens nor closes.
    expect(inlineParseCost("a \\] b \\* c * d")).toBe(0);
    // Behind punctuation, `*` before a letter cannot open: every one finds none.
    expect(inlineParseCost("a*.a*.a*.")).toBe(1 + 4 + 7);
    // The rule of three keeps `*` from closing `**` where one of them could do both: both find none.
    expect(inlineParseCost("a**b*")).toBe(1 + 4);
    expect(exceedsInlineParseBudget("]".repeat(Math.ceil(Math.sqrt(2 * INLINE_PARSE_BUDGET)) + 1))).toBe(true);
    expect(exceedsInlineParseBudget("a".repeat(1_000_000))).toBe(false);
    expect(exceedsInlineParseBudget("[x] ".repeat(MAX_CLOSING_BRACKETS))).toBe(false);
    // The editor's parser looks back at every link that closes: past this many, a block is read as written.
    expect(exceedsInlineParseBudget("[x] ".repeat(MAX_CLOSING_BRACKETS + 1))).toBe(true);
  });

  it("keeps the length of the text and gives every character back", () => {
    const stretch = "\\[x](y) `c` <b> &amp; ![p](q) $m$ a|b " + "]".repeat(20_000);
    const text = `head\n\n${stretch}\n\ntail`;
    const bounded = boundMarkdownForParse(text);
    expect(bounded.text).toHaveLength(text.length);
    expect(bounded.text.startsWith("head\n\n")).toBe(true);
    expect(bounded.text.endsWith("\n\ntail")).toBe(true);
    expect(restoreBoundedValue(bounded.text)).toBe(text);
    // Nothing of Markdown is left in the stretch for a parser to read.
    const inside = bounded.text.slice(bounded.ranges[0].from, bounded.ranges[0].to);
    expect(inside).not.toMatch(/[\\[\]*_~`<&!$|]/);
  });

  it("restores only what stands inside a stretch: a noncharacter written elsewhere stays", () => {
    const standIn = String.fromCharCode(0xfdd0);
    const tree = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 100 } },
      children: [
        { type: "text", value: `out${standIn}`, position: { start: { offset: 0 }, end: { offset: 10 } } },
        { type: "text", value: `in${standIn}`, position: { start: { offset: 50 }, end: { offset: 60 } } },
        { type: "text", value: `placeless${standIn}` },
      ],
    };
    restoreBoundedTree(tree, [{ from: 40, to: 70 }]);
    expect(tree.children.map((child) => child.value)).toEqual([`out${standIn}`, "in\\", "placeless\\"]);
  });

  it("turns a noncharacter inside a stretch into U+FFFD, so it cannot come back as markup", () => {
    const standIn = String.fromCharCode(0xfdd1);
    const text = `${standIn}${"]".repeat(20_000)}`;
    const tree = parseMarkdownTree(text);
    expect(textsOf(tree).join("")).toBe(String.fromCharCode(0xfffd) + "]".repeat(20_000));
  });
});

describe("where a table ends", () => {
  // The table scan of the parse budget against the table parser (L13). A row
  // the scan ends too early escapes the table's weight — its parse ran out of
  // memory under a capped heap; a line it takes for a table where the parser
  // reads a paragraph splits the paragraph's measure. Found in review:
  // lines without a pipe, and lines that begin with `*a*`, `<b>` or `=`, are
  // rows to the parser and ended the table in the scan.
  // The table parser itself, without the budget: what the scan must agree with.
  const rawParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks);
  const rawTree = (text: string) => rawParser.parse(text) as unknown as MarkdownTreeNode;
  const tablesOf = (tree: MarkdownTreeNode, into: Array<[number, number]> = []): Array<[number, number]> => {
    const place = (tree as { position?: { start: { line: number }; end: { line: number } } }).position;
    if (tree.type === "table" && place) into.push([place.start.line - 1, place.end.line - 1]);
    for (const child of tree.children ?? []) tablesOf(child, into);
    return into;
  };
  const paragraphsOf = (tree: MarkdownTreeNode, into: Array<[number, number]> = []): Array<[number, number]> => {
    const place = (tree as { position?: { start: { line: number }; end: { line: number } } }).position;
    if (tree.type === "paragraph" && place && place.end.line > place.start.line) into.push([place.start.line - 1, place.end.line - 1]);
    for (const child of tree.children ?? []) paragraphsOf(child, into);
    return into;
  };
  const rowsOf = (text: string): number => {
    const tree = rawTree(text);
    const table = tablesOf(tree)[0];
    return table ? table[1] - table[0] : -1;
  };
  const over = (row: string, header = "| h |\n|---|") => {
    const rows = Math.ceil((1.2 * TABLE_READ_BUDGET) / tableReadCost(row, 0, row.length));
    return `${header}\n${Array.from({ length: rows }, () => row).join("\n")}\n`;
  };

  it("weighs every row the parser reads, with or without a pipe", () => {
    // The parser keeps these lines in the table (one header, one delimiter, three rows).
    for (const row of ["a", "bar", "*a* | b", "_x_ | y", "<b>q</b> | z", "=", "-a | b", "+a | b", "<x-y> | b", "[x]: http://a | b", "1234567890. a | b"]) {
      expect(rowsOf(`| h | h |\n|---|---|\n| a | b |\n${row}\n| z | z |\n`), row).toBe(4);
      const text = over(row, "| h | h |\n|---|---|");
      expect(overBudgetInlineRanges(text), row).toEqual([{ from: 0, to: text.length - 1 }]);
    }
    // A header without a pipe over a delimiter with one is a table too.
    expect(rowsOf("a\n|-\n| b |\n")).toBe(2);
    const headless = over("a", "a\n|-");
    expect(overBudgetInlineRanges(headless)).toEqual([{ from: 0, to: headless.length - 1 }]);
    // Over its budget, the parse reads them as written: no table.
    expect(typesOf(parseMarkdownTree(over("a")))).not.toContain("table");
  });

  it("ends a table at a line that begins another block, as the parser does", () => {
    for (const row of ["", "    a | b", "> q | y", "# h | x", "- x | y", "-", "1.", "2. a | b", "***", "```", "~~~ | b", "[^1]: a | b", "<div>|", "<!-- c | b", "<divx>"]) {
      expect(rowsOf(`| h | h |\n|---|---|\n| a | b |\n${row}\n| z | z |\n`), JSON.stringify(row)).toBe(2);
    }
    // A table over the budget behind such a line is weighed from its own header.
    const behind = `| h |\n|---|\n- x\n${over("a")}`;
    expect(overBudgetInlineRanges(behind)).toEqual([{ from: behind.indexOf("| h |", 4), to: behind.length - 1 }]);
  });

  it("weighs a table the parser reads where a reader would not expect one", () => {
    // Behind indented code, `-` is a table's header; behind `<!X`, a fence is
    // HTML and the table under it a table; a tab behind `>` gives the marker
    // one column, so `>\t|a|` is a row and no indented code.
    const cases: Array<[string, string]> = [
      ["    x\n-\n|-|", "|a|"],
      ["<!X\n~~~\nx>\n| h |\n|-|", "|a|"],
      ["> | h |\n> |-|", ">\t|a|"],
      ["> | h |\n> |-|", "> \t|a|"],
    ];
    for (const [before, row] of cases) {
      // Weighed behind its quote markers, as the scan weighs it.
      const body = row.slice(row.indexOf("|"));
      const text = `${before}\n${Array.from({ length: Math.ceil((1.2 * TABLE_READ_BUDGET) / tableReadCost(body, 0, body.length)) }, () => row).join("\n")}\n`;
      const small = tablesOf(rawTree(`${before}\n${row}\n${row}\n`));
      expect(small.length, before).toBe(1);
      // The header, the delimiter and both rows.
      expect(small[0][1] - small[0][0], before).toBe(3);
      const ranges = overBudgetInlineRanges(text);
      expect(ranges.length, before).toBeGreaterThan(0);
      expect(ranges[ranges.length - 1].to, before).toBe(text.length - 1);
      expect(typesOf(parseMarkdownTree(text)), before).not.toContain("table");
    }
  }, 120 * SECONDS);

  it("weighs a table right behind a byte order mark", () => {
    // The mark was a character of the header to the scan: one cell more than the delimiter row, so no table, and its parse ran out of memory.
    const text = `\uFEFF${over("|a|")}`;
    expect(tablesOf(rawTree("\uFEFF| h |\n|---|\n|a|\n"))).toHaveLength(1);
    expect(overBudgetInlineRanges(text)).toEqual([{ from: 1, to: text.length - 1 }]);
  });

  it("keeps a paragraph whole where its lazy lines look like a table", () => {
    // In a quote, `]]]] | x` over `-|-` without the marker is text of the
    // quote's paragraph, not a table: the scan split the paragraph at each
    // pair, and its parse looked back over all of it at every `]`.
    const pairs = Array.from({ length: 3_000 }, () => "]]]] | x\n-|-").join("\n");
    const text = `> q\n${pairs}\n\nbelow [[Link]]\n`;
    expect(tablesOf(rawTree(`> q\n]]]] | x\n-|-\n]]]] | x\n-|-\n`))).toEqual([]);
    const ranges = overBudgetInlineRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].to).toBe(text.indexOf("\n\nbelow"));
    const tree = within(5 * SECONDS, () => parseMarkdownTree(text));
    expect(typesOf(tree.children![1])).toContain("wikiLink");
  }, 60 * SECONDS);

  it("ends a table where the table parser ends it, over generated notes", () => {
    // Lines and block markers drawn at random, seeded: every table the parser
    // reads lies inside one the scan weighs, and every paragraph of more than
    // one line inside one run the scan measures, unless the scan was unsure
    // and weighed the table generously (then it measures the run as well).
    const contents = ["| a | b |", "|---|---|", "a | b", "--|--", "|-", "-|", "a", "bar", "*a* | b", "_x_ | y", "<b>q</b> | z", "<div>", "<divx>", "<x-y> | b", "# h", "#a | x", "- x | y", "-", "- ", "1. a", "2. a", "1)", "10.", "***", "---", "===", "```", "~~~", "``", "[^1]: a", "[^ x]: a", "[x]: http://a", "", "    a | b", "  a | b", "\t| a |", "<!-- c", "<!-- a -->", "<?x", "<!X", "<!", "* * *", "+a", "| `a\\|b` |", "\\| a |", "> [!note] t", "h|h", "-|-", "|:-:|", "| x |", "x |", "<p/>", "</td>", "[^a b]: x", " | a |", "   |-|", "+", "1.", "    x", "\tx", "x\\", "- [ ] |"];
    const prefixes = ["", "", "", "> ", "- ", "  ", "> > ", ">", "   ", "1. ", "    ", "\t", "- > ", "> - ", ">   "];
    let seed = 20261113;
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const inside = ([a, b]: [number, number], spans: Array<[number, number]>) => spans.some(([c, d]) => c <= a && b <= d);
    const meets = ([a, b]: [number, number], spans: Array<[number, number]>) => spans.some(([c, d]) => c <= b && a <= d);
    const failures: string[] = [];
    for (let k = 0; k < 3_000; k++) {
      const lines: string[] = [];
      const count = 3 + Math.floor(random() * 8);
      while (lines.length < count) {
        if (random() < 0.35) {
          const first = pick(prefixes);
          const rest = random() < 0.7 ? first.replace(/^(\d+\.|-) /, (marker) => " ".repeat(marker.length)) : pick(prefixes);
          lines.push(first + pick(["| a | b |", "a | b", "h|h", "a", "| x |", "x |", "*a* | b"]), rest + pick(["|---|---|", "--|--", "-|-", "|-", "-|", "|:-:|"]));
        } else {
          lines.push((random() < 0.5 ? pick(prefixes) : "") + pick(contents));
        }
      }
      // An unclosed `---` on the first line puts the frontmatter reader in a mode of its own.
      if (/^---[ \t]*$/.test(lines[0])) lines[0] = "x";
      const text = `${lines.join("\n")}\n`;
      const tree = rawTree(text);
      const tables: Array<[number, number]> = [];
      const exact: Array<[number, number]> = [];
      const runs: Array<[number, number]> = [];
      overBudgetInlineRanges(text, {
        table: (first, last, sure) => {
          tables.push([first, last]);
          if (sure) exact.push([first, last]);
        },
        run: (first, last) => runs.push([first, last]),
      });
      const missed = tablesOf(tree).filter((table) => !inside(table, tables));
      const split = paragraphsOf(tree).filter((paragraph) => !inside(paragraph, runs) && meets(paragraph, exact));
      if (missed.length + split.length > 0) failures.push(JSON.stringify({ text, missed, split }));
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 120 * SECONDS);
});

