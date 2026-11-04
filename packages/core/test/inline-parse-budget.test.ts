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
} from "../src/inlineParseBudget.ts";
import { parseCommonMarkTree, parseMarkdownAst, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { analyzeNoteOutline, analyzeNoteSource } from "../src/noteSource.ts";

/**
 * The parse budget (open-items plan 3.133 no. 4): a line of 100 000 `]` held
 * the reading view and the note source for minutes, because the Markdown
 * parser looks back over a whole paragraph at each `]`, `*`, `_` and `~`. The
 * same work came from short lines without a blank line between them, and from
 * a table of many rows. A stretch over the budget is read as written; every
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

  it("bounds a table of many rows: it is read as text, every other block as before", () => {
    const rows = Array.from({ length: 8_000 }, (_, i) => `| row ${i} | [[n${i}]] |`);
    const table = ["| a | b |", "|---|---|", ...rows].join("\n");
    const note = `# Data\n\n${table}\n\nbelow [[Link]]\n`;
    const tree = within(10 * SECONDS, () => parseMarkdownTree(note));
    expect(tree.children!.map((node) => node.type)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(textsOf(tree.children![1]).join("")).toBe(table);
    expect(typesOf(tree.children![2])).toContain("wikiLink");
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
    // A line without a pipe after the table is measured with what follows it.
    expect(overBudgetInlineRanges(["| a |", "|---|", "| b |", ...costly].join("\n"))).toHaveLength(1);
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
