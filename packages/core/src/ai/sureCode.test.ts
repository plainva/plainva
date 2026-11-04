import { describe, expect, it } from "vitest";
import { lintReach, sureFencedCode } from "./sureCode.js";

/**
 * The code of a whole note that every renderer shows as code (strand 6,
 * Nr. 12): a check of what an assistant writes may leave only that as it is,
 * so it errs towards text — never towards code.
 */

const codeOf = (text: string) => sureFencedCode(text).map((range) => text.slice(range.from, range.to));
const FENCE = "```";

describe("sure fenced code", () => {
  it("is a fence that opens at the start of its line or right behind quote markers, to its closing line", () => {
    const text = ["Text", FENCE, "<b>code</b>", FENCE, "after", `> ${FENCE}html`, "> <img src=x>", `> ${FENCE}`, "end"].join("\n");
    expect(codeOf(text)).toEqual([`${FENCE}\n<b>code</b>\n${FENCE}\n`, `> ${FENCE}html\n> <img src=x>\n> ${FENCE}\n`]);
    // One that never closes runs to the end; one in a quote ends with the quote.
    expect(codeOf(`${FENCE}\na\nb`)).toEqual([`${FENCE}\na\nb`]);
    expect(codeOf(`> ${FENCE}\n> a\nafter\n`)).toEqual([`> ${FENCE}\n> a\n`]);
  });

  it("is none behind blanks, a list item's marker or an indentation of four — and from such a run on, none at all", () => {
    expect(codeOf(["- a", `  ${FENCE}`, "  x", `  ${FENCE}`].join("\n"))).toEqual([]);
    expect(codeOf([`- ${FENCE}`, "  x", `  ${FENCE}`].join("\n"))).toEqual([]);
    expect(codeOf([`    ${FENCE}`, "    x"].join("\n"))).toEqual([]);
    // Whether a run at the start of a line then closes the first or opens a fence of its own depends on where the
    // first stood — in a list item a run at the start opens one, at the top behind two blanks it closes —, so
    // neither is sure, nor is any fence after it.
    expect(codeOf(["- a", `  ${FENCE}`, "  x", FENCE, "![](//host/p.png)", FENCE, "y"].join("\n"))).toEqual([]);
    expect(codeOf(["Text", `  ${FENCE}`, "  x", FENCE, "y", FENCE, "z", FENCE].join("\n"))).toEqual([]);
    // Before it, a fence is sure.
    expect(codeOf([FENCE, "c", FENCE, "- a", `  ${FENCE}`].join("\n"))).toEqual([`${FENCE}\nc\n${FENCE}\n`]);
  });

  it("is none in an HTML block or the properties block, and sure again behind them", () => {
    expect(codeOf(["<!--", FENCE, "-->", "![](//host/p.png)"].join("\n"))).toEqual([]);
    expect(codeOf(["<details>", FENCE, "</details>", "", "text"].join("\n"))).toEqual([]);
    expect(codeOf(["<!-- one line -->", FENCE, "c", FENCE].join("\n"))).toEqual([`${FENCE}\nc\n${FENCE}`]);
    expect(codeOf(["<div>", "x", "", FENCE, "c", FENCE].join("\n"))).toEqual([`${FENCE}\nc\n${FENCE}`]);
    expect(codeOf(["---", `title: "${FENCE}"`, "---", "text", FENCE, "c", FENCE].join("\n"))).toEqual([`${FENCE}\nc\n${FENCE}`]);
    // A run in the properties block is no run of the note's text, and makes nothing after it unsure.
    expect(codeOf(["---", "note: |", `  ${FENCE}`, "---", "text", FENCE, "c", FENCE].join("\n"))).toEqual([`${FENCE}\nc\n${FENCE}`]);
    // An HTML block in a list item or a quote counts too, read leniently; a line of other blanks ends no block.
    expect(codeOf(["- <!--", FENCE, "-->", "x"].join("\n"))).toEqual([]);
    expect(codeOf(["<div>", String.fromCharCode(0xa0), FENCE, "c", FENCE].join("\n"))).toEqual([]);
  });

  it("is none for a code span at the start of a line, and reads a text with \\r\\n as one with \\n", () => {
    expect(codeOf(`${FENCE}x${FENCE} and then\nmore`)).toEqual([]);
    expect(codeOf(`a\r\n${FENCE}\r\nc\r\n${FENCE}\r\nb`)).toEqual([`${FENCE}\r\nc\r\n${FENCE}\r\n`]);
  });
});

/** Strand 6, Nr. 12: what a check of a change in a whole note reads with it, beyond the paragraphs it touched. */
describe("what a check of a whole note reads together", () => {
  const together = (text: string) => lintReach(text).together.map((range) => text.slice(range.from, range.to));

  it("reads an HTML block that keeps its text raw over blank lines as one, from its first line to its end mark", () => {
    const pre = "<pre>\n<b>x</b>\n\nmore\n</pre>\n";
    expect(together(`Intro.\n\n${pre}\nafter`)).toEqual([pre]);
    for (const block of ["<!--\n\nx\n-->\n", "<?x\n\ny\n?>\n", "<![CDATA[\n\nx\n]]>\n", "> <style>\n>\n> x\n> </style>\n", "- <pre>\n\n  x\n  </pre>\n"]) {
      expect(together(`a\n\n${block}\nb`), block).toEqual([block]);
    }
    // In a quote, the block ends with the quote.
    expect(together("> <pre>\n\nafter")).toEqual(["> <pre>\n\n"]);
    // One that ends on its line, and one that ends at a blank line, is no more than its paragraph.
    expect(together("<!-- one -->\n\ntext")).toEqual([]);
    expect(together("<div>\nx\n\ntext")).toEqual([]);
    // Without its end mark it runs to the end of the note.
    expect(together("a\n\n<!--\n\nb")).toEqual(["<!--\n\nb"]);
  });

  it("reads a tag left open at the end of its paragraph with everything after it, the first one", () => {
    const text = ["Text.", "", "<div>", '<img src="//host/p.png?d=', "", "more", "", '<a href="x', "end"].join("\n");
    expect(together(text)).toEqual([text.slice(text.indexOf("<img"))]);
    expect(together("<div>\n<img\n\n<!-- src=x -->")).toEqual(["<img\n\n<!-- src=x -->"]);
    // A quote that never closes holds the rest of the note, however many lines follow.
    expect(together('Text.\n\n<img src="//host/p.png?d=\n\nmore')).toEqual(['<img src="//host/p.png?d=\n\nmore']);
    // One that closes in its paragraph is none, a ">" in a quoted value and a "<" in it included.
    expect(together('<img title=">" src="x">\n\n<img alt="<" src=y>\n\ntext')).toEqual([]);
  });

  it("names the tags that give what follows them a context, and <base>, which gives the whole note one", () => {
    const text = "<style>\n.a{}\n</style>\n\n<FORM action=x>\n\n<base href=y>\n\n<styles>";
    expect(lintReach(text).armed).toEqual([
      { at: 0, global: false },
      { at: text.indexOf("<FORM"), global: false },
      { at: text.indexOf("<base"), global: true },
    ]);
  });

  it("reads nothing in the properties block or in sure code", () => {
    const text = ["---", 'x: "<style>"', 'y: "<img src=\\""', "---", FENCE, "<style>", '<img src="', "<!--", FENCE, "text"].join("\n");
    expect(lintReach(text)).toEqual({ together: [], armed: [] });
  });
});
