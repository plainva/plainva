import { afterEach, describe, expect, it } from "vitest";
import { NOTE_BUDGET, NOTE_READING, PIECE_SHARE, overBudgetInlineRanges, readAsTextParts, setNoteBudget, setPieceShare, type MarkdownReading } from "../src/inlineParseBudget.ts";
import { forEachReadPiece, parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { extractFrontmatter } from "../src/metadata-extractor.ts";
import { readNoteLinks, renameNoteLinks } from "../src/linkRewrite.ts";
import { analyzeNoteSource, planBlockLink, selectNoteFragment } from "../src/noteSource.ts";
import { within } from "./helpers/timeBudget.js";

/**
 * A block the note's budget reads as text is read for its facts in pieces by
 * the parser itself (`readAsTextParts`, `forEachReadPiece`): the index's links
 * and tags, a rename, the headings and block ids of the note source. Each
 * piece begins where the note itself does, so that read alone it is read as in
 * the note. These tests read notes with the note's budget at its least, so
 * that every block is read as text, and every unit and list item a piece of its
 * own — every cut there is — against the same notes read whole, without the
 * note's budget: every fact must be the same. Only what is unread may differ,
 * and it is named.
 */

const SECONDS = 1000;
const frontmatterData = (ast: Parameters<typeof extractFrontmatter>[0]) => {
  const result = extractFrontmatter(ast);
  return result.success ? result.data : null;
};
const WHOLE: MarkdownReading = { ...NOTE_READING, notes: false };
const filler = Array.from({ length: 120 }, (_, i) => `Plain sentence number ${i} with some words in it.`).join(" ");

afterEach(() => {
  setNoteBudget(NOTE_BUDGET);
  setPieceShare(PIECE_SHARE);
});

interface Facts {
  index: string;
  rename: string;
  source: string;
}

const RENAMES = new Map([
  ["Old", "New`x"],
  ["Old.md", "x|y.md"],
  ["B", "Bee"],
  ["H", "Aitch"],
  ["K", "Kay"],
]);

/** The note's facts as the app reads them, with every block over its budget read as text and every cut a piece. */
function inPieces(note: string): Facts & { unread: number } {
  setNoteBudget(1);
  setPieceShare(1e12, true);
  try {
    const parts = readAsTextParts(note);
    const ast = parseMarkdownAst(note, { preserveObsidianSyntax: true });
    return {
      index: JSON.stringify([extractLinksAndTags(ast, note), frontmatterData(ast)]),
      rename: renameNoteLinks(note, RENAMES).content,
      source: JSON.stringify(analyzeNoteSource(note)),
      unread: parts.unread.length,
    };
  } finally {
    setNoteBudget(NOTE_BUDGET);
    setPieceShare(PIECE_SHARE);
  }
}

/** The same facts with the note read whole, as before the note's budget. */
function whole(note: string): Facts {
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  try {
    const ast = parseMarkdownAst(note, { preserveObsidianSyntax: true, reading: WHOLE });
    return {
      index: JSON.stringify([extractLinksAndTags(ast), frontmatterData(ast)]),
      rename: renameNoteLinks(note, RENAMES).content,
      source: JSON.stringify(analyzeNoteSource(note)),
    };
  } finally {
    setNoteBudget(NOTE_BUDGET);
  }
}

/** Every construct the review of the link search read wrong, and the blocks across blank lines a cut may not split. */
const FORMS: Record<string, string> = {
  indentedCode: "para\n\n    [[Old]]\n",
  fenceInNestedList: "- - ```\n    [[Old]]\n    ```",
  fenceInListQuote: "- > ```\n  > [[Old]]\n  > ```",
  codeSpanTwoLines: "a `b\n[[Old]] c`",
  htmlBlock: "<div>\n[[Old]]\n</div>",
  htmlCommentInline: "text <!-- [[Old]] --> more",
  htmlCommentBlock: "<!--\n[[Old]]\n-->",
  htmlCommentInParaMultiline: "text <!-- note\n[[Old]] -->",
  commentAcrossBlankLines: "<!--\n\n[[Old]]\n\n# Heading [[Old]]\n\n-->\n\n[[Old]]",
  unclosedComment: "- item [[B]]\n<!--\n\n# Heading [[Old]]\n\n- [[Old]]",
  inlineHtmlAttr: 'x <a href="[[Old]]">y</a>',
  autolink: "see <https://e.com/[[Old]]> here",
  linkInLabel: "[see [[Old]]](Old.md)",
  wikiInWikiLabel: "[[[Old]]](Old.md) and x [[[Old]]](y) z",
  linkedImage: "[![i](a.png)](Old.md)",
  mdTitle: '[t](Old.md "title")',
  mdAngle: "[t](<Old.md>)",
  escaped: "\\[[Old]] and \\![[Old]]",
  escBackslash: "\\\\![[Old]]",
  nested: "[[a [[Old]]",
  footnote: "x[^1]\n\n[^1]: see [[Old]]\n\n    more [[Old]] here\n\n    - and [[B]] #inside",
  referenceDefinitionElsewhere: "[see [[Old]]][r] and [r]\n\n# Between\n\n[r]: Old.md",
  tableInBlock: "| a | b |\n|---|---|\n| [[Old\\|al]] | [x](Old.md) |",
  obsidianComment: "%%[[Old]]%%",
  mathBlock: "$$\n[[Old]]\n$$",
  inlineMath: "$a [[Old]] b$",
  codeSpans: "`[[Old]]` and ``x ` [[Old]] ``",
  task: "- [ ] task [[Old]] #tag ^blk1",
  callout: "> [!note]\n> see [[Old]] and [l](Old.md)",
  fenceUnclosedInItem: "- ```\n  code\nlazy [[Old]]",
  fenceInItemAcrossBlankLine: "- ```\n  code\n\n  [[Old]]\n  ```\n\nafter [[Old]]",
  topFenceAcrossBlankLines: "```\na\n\n[[Old]]\n\n```\n\n[[Old]]",
  wikiBacktick: "[[Old]]`x` [[Old|a`b]]",
  linkWithBracketLabel: "[a [b] c](Old.md)",
  linkCodeLabel: "[a `]` c](Old.md)",
  embeds: "![[Old]] ![alt](Old.md)",
  deepIndent: "- a\n\n        [[Old]]\n",
  looseNested: "- a [[Old]]\n\n  - b [[Old]]\n\n    c [[Old]] #t2\n\n- d [[Old]] ^d1",
  setext: "[[Old]] title\n===",
  wikiAcrossBackslash: "[[Old\\]] x]]",
  htmlBlock7: "<custom-tag>\n[[Old]]\n",
  linkDestinationParen: "[t](Old.md)(x)",
  bareAngle: "<Old.md>",
  blockIds: "- one [[Old]] ^blk1\n- two\n\npara [[Old]]\n^blk2",
  orderedAndLazy: "1. a [[Old]]\n2. b\nlazy [[Old]]\n3. c [[Old]]",
  orderedBehindIndentedCode: "```js\n```\n    - deeper [[B]] #deep\n\n2. second [[Old]]\n\n    - deeper [[B]] #deep",
  definitionBehindIndentedCode: "    code\n\n[r]: Old.md\n\n[see [[Old]]][r]",
  fenceInProperties: "title: x",
  indentedHeadingInItem: "- a\n  # In item [[Old]]\n  [[B]] #t3",
};

describe("a block read as text is read for its facts in pieces, as the note read whole (L14)", () => {
  it.each(Object.entries(FORMS))("%s", (name, form) => {
    expect.hasAssertions();
    const note = name === "fenceInProperties" ? `---\na: 1\n\`\`\`\n---\n\`\`\`\n\n| [[Old]] |\n\n${filler}\n` : `# T\n\n${filler}\n\n${form}\n\n${filler}\n`;
    const got = inPieces(note);
    expect(got.unread).toBe(0);
    const want = whole(note);
    expect(got.index).toBe(want.index);
    expect(got.rename).toBe(want.rename);
    expect(got.source).toBe(want.source);
  });

  it("reads 300 random notes of every construct, joined with and without blank lines, as the note read whole", () => {
    expect.hasAssertions();
    const pieces = ["# Heading [[A]]", "- item [[B]] #tag", "- [ ] task [[C|alias]] due ^b1", "  - nested [[B2]]", "    - deeper [[B3]] #deep", "> quote *em* [[D#h]]", "> [!note]\n> callout [x](E.md)", "```js\nconst a = '[[F]]';\n```", "| a | b |\n|---|---|\n| [[G\\|g]] | `c` |", "Text with ![[img.png]] and https://x.org and <b>html</b> &amp; **bold**", "1. ordered ^blk", "2. second [[O2]]", "    indented [[H]]", "  continued [[H2]]", "<!-- c [[I]] -->", "<!--\n[[I2]]", "-->", "<div>", "</div>", "Para [^1] with `code [[J]]`\n\n[^1]: note [[K]]", "[^2]: foot [[K2]]", "[ref]: Old.md", "[use [[R]]][ref]", "---", "$x$ and $$y$$", "a `b\n[[L]] c`", "```", "~~~", "* * *", "- ```", "- > ```", "Setext [[S]]\n===", "+ plus [[P]]", "3) paren [[Q]]", "\t- tabbed [[T]]", "#tag-only #two", "- [x] done [[Old]] ^id-x"];
    let seed = 7;
    const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
    const differing: string[] = [];
    for (let k = 0; k < 300; k++) {
      const count = Math.floor(random() * 60) + 4;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) parts.push(pieces[Math.floor(random() * pieces.length)] + (random() < 0.5 ? "\n\n" : "\n"));
      const note = `${parts.join("")}\n\n${filler}\n`;
      const got = inPieces(note);
      // Behind an unclosed `---` at its start, no part of a note is read alone as there: unread, and named.
      if (got.unread > 0) {
        expect(note.startsWith("---\n")).toBe(true);
        continue;
      }
      const want = whole(note);
      if (got.index !== want.index || got.rename !== want.rename || got.source !== want.source) differing.push(note);
    }
    expect(differing.slice(0, 3)).toEqual([]);
  }, 300 * SECONDS);
});

describe("the cases of the review of the link search (2026-11-19), at the real budget", () => {
  it("renames the links of a large note as the note read whole does: none in a comment, every titled and linked-image link", () => {
    expect.hasAssertions();
    const note = `# Big\n\n${Array.from({ length: 6_000 }, (_, i) => `- item ${i} [![b](badge.svg)](Old.md) [doc](Old.md "Doc") <!-- old: [[Old]] --> [[Keep]]`).join("\n")}\n`;
    expect(readAsTextParts(note).ranges.some((range) => range.block)).toBe(true);
    const renames = new Map([["Old", "New"], ["Old.md", "New.md"]]);
    const result = renameNoteLinks(note, renames);
    expect(result.content.split("](New.md)").length - 1).toBe(6_000);
    expect(result.content.split('(New.md "Doc")').length - 1).toBe(6_000);
    expect(result.content.split("<!-- old: [[Old]] -->").length - 1).toBe(6_000);
    expect(result.unplaced).toBe(0);
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    expect(result.content).toBe(renameNoteLinks(note, renames).content);
  }, 120 * SECONDS);

  it("renames to a name with a backtick in a large block with open backticks in time, and as the note read whole", () => {
    expect.hasAssertions();
    const note = Array.from({ length: 6_000 }, (_, i) => (i < 50 ? `- item ${i} a \` b [[Old]] [[Keep]]` : `- item ${i} [[Old]] [[Keep]]`)).join("\n") + "\n";
    expect(readAsTextParts(note).ranges.some((range) => range.block)).toBe(true);
    // The rounds that leave out the links a backtick turns into code are bounded per paragraph: in time.
    const result = within(10 * SECONDS, () => renameNoteLinks(note, new Map([["Old", "New`x"]])));
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    const want = renameNoteLinks(note, new Map([["Old", "New`x"]]));
    expect(result.content).toBe(want.content);
    expect(result.unplaced).toBe(want.unplaced);
  }, 120 * SECONDS);

  it("keeps the tags, links, properties, headings and block ids of a large block read as text, and copies a link to its line there", () => {
    expect.hasAssertions();
    const probe = [
      "- [ ] open task with [[TaskLink]] #tasktag ^blk1",
      "- see [doc](#section) and https://x.com/page#frag and `#codetag` and <!-- #commenttag -->",
      "- embed ![[Pic.png]] and ![[Other#Sec]] and [[Self#Head A]]",
      "- ```",
      "  #fencetag [[FenceLink]]",
      "  ```",
      "- footnote ref[^1] and #realtag",
      "- line with block id ^blk2",
    ];
    const lines = Array.from({ length: 6_000 }, (_, i) => `- item ${i} [[Keep]]`);
    lines.splice(3_000, 0, ...probe);
    const note = `---\ntags: [fmtag]\nup: "[[FmLink]]"\n---\n# Head A\n\n${lines.join("\n")}\n\n[^1]: def [[FootTarget]]\n\n## Head B\n\n    #indentedtag [[IndentLink]]\n`;
    expect(readAsTextParts(note).ranges.some((range) => range.block)).toBe(true);
    const ast = parseMarkdownAst(note, { preserveObsidianSyntax: true });
    const got = JSON.stringify([extractLinksAndTags(ast, note), frontmatterData(ast), analyzeNoteSource(note)]);
    const fragments = ["^blk1", "^blk2", "Head A"].map((anchor) => selectNoteFragment(note, anchor));
    const at = note.indexOf("- item 100 ") + 4;
    const plan = planBlockLink(note, at, () => 0.5);
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    const whole = parseMarkdownAst(note, { preserveObsidianSyntax: true, reading: WHOLE });
    expect(got).toBe(JSON.stringify([extractLinksAndTags(whole), frontmatterData(whole), analyzeNoteSource(note)]));
    expect(fragments).toEqual(["^blk1", "^blk2", "Head A"].map((anchor) => selectNoteFragment(note, anchor)));
    expect(plan).toEqual(planBlockLink(note, at, () => 0.5));
    setNoteBudget(NOTE_BUDGET);
    // The id is written on the item's own line, and the link leads to that item.
    expect(plan.kind).toBe("block");
    if (plan.kind !== "block" || !plan.insert) throw new Error("no id written");
    expect(note.slice(0, plan.insert.at).split("\n").length).toBe(note.slice(0, at).split("\n").length);
    const written = note.slice(0, plan.insert.at) + plan.insert.text + note.slice(plan.insert.at);
    const found = selectNoteFragment(written, `^${plan.id}`);
    expect(found.status === "found" && found.text.startsWith("- item 100 ")).toBe(true);
  }, 120 * SECONDS);

  it("renames a Markdown link in a table row of a block read as text to a name with a bar, as the note read whole", () => {
    expect.hasAssertions();
    const note = `# T\n\n${filler}\n\n| a | b |\n|---|---|\n| [t](<Old.md>) | [u](Old.md) |\n`;
    setNoteBudget(1);
    setPieceShare(1e12, false);
    const got = renameNoteLinks(note, new Map([["Old.md", "x|y.md"]])).content;
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    expect(got).toBe(renameNoteLinks(note, new Map([["Old.md", "x|y.md"]])).content);
  });

  it("lists each link of a block read as text that holds a table over the table budget once, as the note read whole", () => {
    expect.hasAssertions();
    const rows = Array.from({ length: 2_500 }, (_, i) => `| r${i} [[Row${i % 3}]] | ${"word ".repeat(20)} [x](Old.md) |`).join("\n");
    const note = `# T\n\nlead line [[Lead]] and [y](Old.md)\nsecond line [[Second]]\n| a | b |\n|---|---|\n${rows}\nafter [[After]]\n\n# End\n`;
    setNoteBudget(1);
    setPieceShare(1e12, false);
    const got = readNoteLinks(note).links.map((link) => `${link.type}:${link.target}@${link.start}`);
    const index = JSON.stringify(extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note));
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    expect(got).toEqual(readNoteLinks(note).links.map((link) => `${link.type}:${link.target}@${link.start}`));
    expect(index).toBe(JSON.stringify(extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true, reading: WHOLE }))));
  }, 120 * SECONDS);

  it("never reads the properties block as text, behind a byte order mark and with CRLF as well", () => {
    expect.hasAssertions();
    const body = Array.from({ length: 300 }, (_, i) => `- item ${i} [[Keep]]`).join("\n");
    const notes = {
      plain: `---\ntitle: X\ntags: [a]\n---\n# H\n\n${body}\n`,
      bom: `\ufeff---\ntitle: X\ntags: [a]\n---\n# H\n\n${body}\n`,
      crlf: `---\r\ntitle: X\r\ntags: [a]\r\n---\r\n# H\r\n\r\n${body.replace(/\n/g, "\r\n")}\r\n`,
      bomCrlf: `\ufeff---\r\ntitle: X\r\n---\r\n\r\n${body.replace(/\n/g, "\r\n")}\r\n`,
    };
    for (const [name, note] of Object.entries(notes)) {
      const got = inPieces(note);
      setNoteBudget(1);
      const first = readAsTextParts(note).ranges[0];
      setNoteBudget(NOTE_BUDGET);
      expect(note.slice(first.from, first.from + 3), name).not.toBe("---");
      expect(got, name).toEqual({ ...whole(note), unread: 0 });
    }
  });
});

describe("what the note's budget leaves unread", () => {
  it("is counted by a rename where it names the renamed note, and rewritten nowhere", () => {
    expect.hasAssertions();
    // A paragraph over the inline budget: no reading of links reaches it, so a link to `Old` there stays as it is —
    // and the rename says that one may still name the old file.
    const stretch = `[[Old]] ${"x]".repeat(20_000)}`;
    const note = `[[Old]]\n\n${stretch}\n\n[[Other]]\n`;
    const result = renameNoteLinks(note, new Map([["Old", "New"]]));
    expect(result.content).toBe(`[[New]]\n\n${stretch}\n\n[[Other]]\n`);
    expect(result.renamed).toBe(1);
    expect(result.unplaced).toBe(1);
    expect(renameNoteLinks(note, new Map([["Gone", "New"]])).unplaced).toBe(0);
  });
});

describe("a stretch read as text with many callout markers", () => {
  it("is read for the index without overrunning the stack: the markers' nodes are put in place in pieces", () => {
    expect.hasAssertions();
    // A callout's marker (`[!note]`) becomes a node of its own for the serializer: in a block read as text, whose
    // characters the tree holds as one text, 150 000 of them were spread into one call and overran the stack.
    const note = `# T\n\n${Array.from({ length: 150_000 }, (_, i) => `> [!note] Title ${i}`).join("\n")}\n`;
    expect(readAsTextParts(note).ranges.some((range) => range.block)).toBe(true);
    const ast = parseMarkdownAst(note, { preserveObsidianSyntax: true });
    expect(ast.children.length).toBeGreaterThan(0);
  }, 120 * SECONDS);

  it("keeps an indented block with the block before it: the item's second paragraph is read as text with its item", () => {
    expect.hasAssertions();
    // The heaviest block of the note is the second paragraph of an item, indented under it: read as text alone, the
    // note's tree would end the item before it and read the paragraph as one of the note's own (mutation X6 of the
    // review of L14, 2026-11-26: no test saw the block cut there). The block read as text begins at its item.
    setNoteBudget(NOTE_BUDGET);
    const heavy = (n: number) => Array.from({ length: n }, (_, i) => `  line ${i} of the item's second paragraph [[Deep ${i % 9}]] *em* \`c\``).join("\n");
    const light = Array.from({ length: 40 }, (_, i) => `Light paragraph ${i} [[Light]].`).join("\n\n");
    const note = (n: number) => `# T\n\n${light}\n\n- the item [[Item]]\n\n${heavy(n)}\n\n- the next item\n`;
    let n = 1_000;
    while (!overBudgetInlineRanges(note(n)).some((range) => range.block)) n *= 2;
    const text = note(n);
    const item = text.indexOf("- the item");
    const second = text.indexOf("  line 0");
    const blocks = overBudgetInlineRanges(text).filter((range) => range.block);
    expect(blocks.some((range) => range.from <= second && second < range.to), "the second paragraph is read as text").toBe(true);
    expect(blocks.some((range) => range.from <= item && second < range.to), "with its item").toBe(true);
  });

  it("reads pieces side by side that refer to the same many definitions as one, and as the note read whole", () => {
    expect.hasAssertions();
    // 2 000 definitions every paragraph refers to were read again behind every piece: 3 MB took the index 25 s (review
    // of L14, 2026-11-26, M3). Read together, the pieces are parsed fewer times than there are pieces.
    setNoteBudget(NOTE_BUDGET);
    const defs = Array.from({ length: 2000 }, (_, i) => `[s${i}]: T${i}.md`).join("\n");
    const para = Array.from({ length: 2000 }, (_, i) => `[s${i}]`).join(" ");
    const note = `# Shared\n\n${defs}\n\n${Array.from({ length: 100 }, (_, k) => `${para} [[Link ${k}]]`).join("\n\n")}\n`;
    const parts = readAsTextParts(note);
    expect(parts.pieces.length).toBeGreaterThan(20);
    const tree = parseMarkdownAst(note, { preserveObsidianSyntax: true });
    let reads = 0;
    forEachReadPiece(note, parts, tree, { preserveObsidianSyntax: true }, () => reads++);
    expect(reads).toBeLessThan(parts.pieces.length / 2);
    const head = extractLinksAndTags(tree, note);
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    expect(head).toEqual(extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note));
  }, 120 * SECONDS);

  it("cuts a list whose items stand up to three blanks in at its items, as the note read whole reads them", () => {
    expect.hasAssertions();
    // `  - [x] done …`, the form of a list moved in by two (review of L14, 2026-11-26): never cut, it lost every link
    // from 3 500 items on the phone, where `main` read 7 194. The list begins with an item moved in, some later ones not.
    setNoteBudget(NOTE_BUDGET);
    for (const indent of ["  ", " ", "   "]) {
      const note = `# T\n\n${Array.from({ length: 8000 }, (_, i) => `${i % 5 === 4 ? "" : indent}- [x] done ${i} [[Project ${i % 40}]] #t${i % 3}${i % 7 === 0 ? `\n${indent}  continued [[More ${i}]]` : ""}`).join("\n")}\n`;
      const parts = readAsTextParts(note);
      expect(parts.pieces.length, JSON.stringify(indent)).toBeGreaterThan(10);
      expect(parts.unread, JSON.stringify(indent)).toEqual([]);
      const head = { index: extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note), rename: renameNoteLinks(note, RENAMES), source: analyzeNoteSource(note) };
      setNoteBudget(Number.MAX_SAFE_INTEGER);
      expect(head.index, JSON.stringify(indent)).toEqual(extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note));
      expect(head.rename, JSON.stringify(indent)).toEqual(renameNoteLinks(note, RENAMES));
      expect(head.source, JSON.stringify(indent)).toEqual(analyzeNoteSource(note));
      setNoteBudget(NOTE_BUDGET);
    }
  }, 300 * SECONDS);
});
