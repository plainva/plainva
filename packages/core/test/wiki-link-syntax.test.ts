import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { readNoteLinks, renameNoteLinks } from "../src/linkRewrite.js";
import { parseMarkdownAst, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";
import { prepareReaderSource } from "../src/noteSource.js";
import { plainWikiLinkInner, wikiLinkParts } from "../src/wikiLink.js";

/**
 * A wiki link is read by the tokenizer, before anything is read into it
 * (finding 2026-10-11, Sammelplan § 3.73 Nr. 2 and 3).
 *
 * It used to be looked for in the text the parser had finished. Whatever
 * Markdown reads something into — an emphasis, a code span, a character
 * reference — was gone from that text by then, and so was the link: no index
 * row for `[[_private_]]`, no backlink, no edge in the graph, and a rename
 * left it on the old name. `[[Tom &amp; Jerry]]` was listed as a link to
 * "Tom & Jerry". The editor reads the line and shows these links; here every
 * reader of the tree does: the index, the link rewriter, the reading view.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const TICK = "`";
const windows = (text: string) => text.replace(/\n/g, "\r\n");

/** Every wiki link node of a tree, with the text it stands on. */
function wikiNodes(tree: MarkdownTreeNode, text: string): Array<{ value: string; embed: boolean; spelled: string }> {
  const out: Array<{ value: string; embed: boolean; spelled: string }> = [];
  const walk = (node: MarkdownTreeNode) => {
    if (node.type === "wikiLink") out.push({ value: node.value!, embed: node.embed === true, spelled: text.slice(node.position!.start.offset, node.position!.end.offset) });
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}
const indexed = (text: string) =>
  extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true })).links.map((link) => [link.type, link.target, link.anchor ?? null, link.alias ?? null, link.line]);

/** The forms of the finding, each with what the index lists for it. */
const FORMS: Array<[note: string, links: Array<[type: string, target: string, anchor: string | null, alias: string | null]>]> = [
  ["[[_private_]]", [["wikilink", "_private_", null, null]]],
  ["[[__init__]]", [["wikilink", "__init__", null, null]]],
  ["[[*Draft*]]", [["wikilink", "*Draft*", null, null]]],
  ["[[~~old~~]]", [["wikilink", "~~old~~", null, null]]],
  ["[[Note|*the* alias]]", [["wikilink", "Note", null, "*the* alias"]]],
  [`[[Note|a ${TICK}code${TICK} alias]]`, [["wikilink", "Note", null, `a ${TICK}code${TICK} alias`]]],
  ["[[_x]] and [[y_]]", [["wikilink", "_x", null, null], ["wikilink", "y_", null, null]]],
  ["[[a*b]] and [[c*d]]", [["wikilink", "a*b", null, null], ["wikilink", "c*d", null, null]]],
  ["![[_drawing_.png|300]]", [["embed", "_drawing_.png", null, "300"]]],
  ["[[_Notes_#_Part_|*p*]]", [["wikilink", "_Notes_", "#_Part_", "*p*"]]],
  ["[[Tom &amp; Jerry]]", [["wikilink", "Tom &amp; Jerry", null, null]]],
  ["[[a_b_c]] and [[snake_case_name]]", [["wikilink", "a_b_c", null, null], ["wikilink", "snake_case_name", null, null]]],
];

describe("a wiki link is read before Markdown reads anything into it", () => {
  it.each(FORMS)("%s", (note, links) => {
    for (const [text, line] of [[`${note}\n`, 1], [`${MARK}# T\r\n\r\n${windows(note)}\r\n`, 3], [`> ${note}\n> more\n`, 1]] as Array<[string, number]>) {
      // The parse: one node per link, standing where the link is written.
      for (const tree of [parseMarkdownTree(text), parseMarkdownAst(text) as unknown as MarkdownTreeNode, parseMarkdownAst(text, { preserveObsidianSyntax: true }) as unknown as MarkdownTreeNode]) {
        const nodes = wikiNodes(tree, text);
        expect(nodes.map((node) => node.spelled), text).toEqual(nodes.map((node) => node.value));
        expect(nodes.map((node) => node.embed), text).toEqual(links.map(([type]) => type === "embed"));
      }
      // The index: a row for each, on its line.
      expect(indexed(text), text).toEqual(links.map(([type, target, anchor, alias]) => [type, target, anchor, alias, line]));
      // The rewriter: the same links, with the place of their names.
      const read = readNoteLinks(text);
      expect(read.unplaced, text).toEqual([]);
      expect(read.links.map((link) => [link.type, link.target, text.slice(link.targetStart, link.targetEnd)]), text).toEqual(links.map(([type, target]) => [type, target, target]));
    }
  });

  it("follows a rename to such a name, and the next rename away from it", () => {
    for (const name of ["__init__", "_private_", "*Draft*", "Tom &amp; Jerry"]) {
      const note = `${MARK}* See [[Old]] and [[Old|*the* alias]]\r\n* and ![[Old#Part]]\r\n`;
      const once = renameNoteLinks(note, new Map([["Old", name]]));
      expect(once).toEqual({ content: note.split("[[Old").join(`[[${name}`), renamed: 3, unplaced: 0 });
      // The index lists the links under the new name — the next rename finds them.
      expect(indexed(once.content).map((row) => row[1])).toEqual([name, name, name]);
      expect(renameNoteLinks(once.content, new Map([[name, "Old"]]))).toEqual({ content: note, renamed: 3, unplaced: 0 });
    }
  });
});

describe("what is a wiki link, and what only looks like one", () => {
  const links = (text: string) => wikiNodes(parseMarkdownTree(text), text).map((node) => node.value);

  it("a link inside a code span, an HTML tag, an address or a block of code or HTML is none", () => {
    expect(links(`${TICK}[[Code]]${TICK} and ${TICK}a [[b${TICK} c]]`)).toEqual([]);
    expect(links('<span title="[[Html]]">x</span> <!-- [[Comment]] -->')).toEqual([]);
    expect(links("<https://example.com/[[Address]]> and https://example.com/[[Bare]]")).toEqual([]);
    expect(links("```\n[[Fence]]\n```\n\n    [[Indented]]\n\n<div>\n[[Block]]\n</div>\n")).toEqual([]);
    expect(links("---\nrelated: \"[[Property]]\"\n---\n")).toEqual([]);
  });

  it("a bracket behind a backslash or spelled as a character reference opens none", () => {
    expect(links("\\[[Escaped]] and [\\[Inner]] and &#91;[Reference]] and &#91;&#91;Both]]")).toEqual([]);
    // A backslash behind a backslash is one: the brackets behind them are written.
    expect(links("\\\\[[Written]]")).toEqual(["[[Written]]"]);
    // A `!` by reference is text: the link behind it is no embed.
    expect(wikiNodes(parseMarkdownTree("&#33;[[Shout]]"), "&#33;[[Shout]]").map((node) => node.embed)).toEqual([false]);
  });

  it("starts where `[[` stands, whatever follows the `]]`", () => {
    // The editor reads these the same way.
    expect(links("[[1]](https://example.com)")).toEqual(["[[1]]"]);
    expect(links("[[link]] and [link]\n\n[link]: https://example.com")).toEqual(["[[link]]"]);
    expect(links("text[^1] and [[^1]]\n\n[^1]: a footnote")).toEqual(["[[^1]]"]);
    expect(links("[[a]b]] [[]] [[[triple]]]")).toEqual(["[[a]b]]", "[[]]", "[[[triple]]"]);
  });

  it("stands in the text of a Markdown link and of a reference link as a link of its own", () => {
    const tree = parseMarkdownTree("[see [[Alpha]] here](Beta.md) and [also [[Gamma]]][ref]\n\n[ref]: Delta.md\n");
    const paragraph = tree.children![0];
    expect(paragraph.children!.map((node) => node.type)).toEqual(["link", "text", "linkReference"]);
    expect(paragraph.children![0].children!.map((node) => node.type)).toEqual(["text", "wikiLink", "text"]);
    expect(paragraph.children![2].children!.map((node) => node.type)).toEqual(["text", "wikiLink"]);
  });

  it("ends with its line, and a bare `|` in a table cell ends the cell before it", () => {
    expect(links("[[a\nb]] [[c\r\nd]]")).toEqual([]);
    expect(links("| a |\n|---|\n| [[Note|alias]] |\n")).toEqual([]);
    expect(links("| a |\n|---|\n| [[Note\\|alias]] |\n")).toEqual(["[[Note\\|alias]]"]);
  });
});

describe("the text between the brackets", () => {
  it("is a file's name, an anchor and an alias, as they are written", () => {
    expect(wikiLinkParts("My\\_Note")).toMatchObject({ target: "My\\_Note", rawTarget: "My\\_Note", aliasStart: -1 });
    expect(wikiLinkParts("My\\_Note").alias).toBeUndefined();
    expect(wikiLinkParts("Tom &amp; Jerry")).toMatchObject({ target: "Tom &amp; Jerry" });
    expect(wikiLinkParts("  Note #Part ^x | the *alias* | more ")).toMatchObject({ target: "Note", rawTarget: "Note #Part ^x", anchor: "#Part ^x", alias: " the *alias* | more ", targetStart: 2, targetEnd: 6 });
    expect(wikiLinkParts("Note^block")).toMatchObject({ target: "Note", anchor: "^block" });
    expect(wikiLinkParts("#Heading")).toMatchObject({ target: "", anchor: "#Heading" });
    expect(wikiLinkParts("")).toMatchObject({ target: "", rawTarget: "", aliasStart: -1, headEnd: 0 });
  });

  it("reads a backslash in front of a bar as part of the bar, the one that begins the alias and one in it", () => {
    expect(wikiLinkParts("Note\\|alias")).toMatchObject({ target: "Note", headEnd: 4, aliasStart: 6, alias: "alias" });
    expect(wikiLinkParts("Note\\|a\\|b")).toMatchObject({ target: "Note", alias: "a|b" });
    expect(wikiLinkParts("Note|a\\|b|c")).toMatchObject({ target: "Note", alias: "a|b|c" });
    expect(plainWikiLinkInner("pic.png\\|300")).toBe("pic.png|300");
    expect(plainWikiLinkInner("pic.png")).toBe("pic.png");
  });
});

describe("the reading view", () => {
  const read = (text: string) => prepareReaderSource(text).text;

  it("shows these links as links, their labels as the text around them is shown", () => {
    expect(read("[[_private_]] and [[Note|*the* alias]]")).toBe("[_private_](wiki://_private_) and [*the* alias](wiki://Note)");
    expect(read(`${MARK}x [[_a_]]\r\ny [[Tom &amp; Jerry]]\r\n`)).toBe("x [_a_](wiki://_a_)\ny [Tom &amp; Jerry](wiki://Tom%20%26amp%3B%20Jerry)\n");
    // A place in a label is a place in the rendered label.
    const source = prepareReaderSource("A [[Note|*the* alias]]");
    const at = "A [[Note|*the* alias]]".indexOf("alias]]");
    expect(source.text.slice(source.toRendered(at), source.toRendered(at) + 5)).toBe("alias");
  });

  it("writes a label as it is where it would not stay in its brackets", () => {
    expect(read("[[a]b]]")).toBe("[a\\]b](wiki://a%5Db)");
    expect(read("[[Trailing\\]]")).toBe("[Trailing\\\\](wiki://Trailing%5C)");
    expect(read(`[[Note|a ${TICK} b]] and ${TICK}code${TICK}`)).toBe(`[a \\${TICK} b](wiki://Note) and ${TICK}code${TICK}`);
    expect(read("[[<b>]]")).toBe("[\\<b\\>](wiki://%3Cb%3E)");
  });

  it("opens the file a link written with `\\|` names, and takes an embed's size from it", () => {
    expect(read("| a |\n|---|\n| [[Note\\|alias]] ![[pic.png\\|300]] |\n")).toBe("| a |\n|---|\n| [alias](wiki://Note) ![img](wiki-image://pic.png%7C300) |\n");
    expect(read("[[Note\\|alias]] and ![[pic.png\\|300]]")).toBe("[alias](wiki://Note) and ![img](wiki-image://pic.png%7C300)");
    // A label written out character for character keeps a `\|` as the bar it spells, in a cell and outside one.
    expect(read("[[Note|a\\|b <x]]")).toBe("[a\\|b \\<x](wiki://Note)");
    expect(read("| a |\n|---|\n| [[Note\\|a\\|b <x]] |\n")).toBe("| a |\n|---|\n| [a\\|b \\<x](wiki://Note) |\n");
  });

  it("leaves a link in the text of another link as it is written, and one behind an escaped backslash as a link", () => {
    expect(read("[see [[Alpha]]](Beta.md) [also [[Gamma]]][ref]\n\n[ref]: Delta.md\n")).toBe("[see [[Alpha]]](Beta.md) [also [[Gamma]]][ref]\n\n[ref]: Delta.md\n");
    expect(read("\\\\[[Note]] and \\[[Not]]")).toBe("\\\\[Note](wiki://Note) and \\[[Not]]");
  });
});

describe("a tree written back", () => {
  it("writes a wiki link as it stands, and keeps a `!` in front of it from making it an embed", () => {
    const prose = "[[_private_]] and [[Note|*the* alias]]\n";
    expect(serializeMarkdownAst(parseMarkdownAst(prose))).toBe(prose);
    // A table comes back in the serializer's form, the link in its cell as it was written.
    const table = serializeMarkdownAst(parseMarkdownAst("| a |\n| - |\n| [[Note\\|alias]] |\n"));
    expect(table).toContain("| [[Note\\|alias]] |");
    expect(indexed(table)).toEqual([["wikilink", "Note", null, "alias", 3]]);
    const written = serializeMarkdownAst({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "Hello!" }, { type: "wikiLink", value: "[[x]]", embed: false }] }] } as never);
    expect(written).toBe("Hello\\![[x]]\n");
    expect(indexed(written).map((row) => row[0])).toEqual(["wikilink"]);
  });
});
