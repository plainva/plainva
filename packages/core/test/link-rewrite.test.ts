import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { readNoteLinks, renameNoteLinks, rewriteNoteLinks, wikiLinkCanName } from "../src/linkRewrite.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";

/**
 * A link is rewritten where it stands (finding 2026-10-09).
 *
 * A rename sent every note that links to the renamed one through the Markdown
 * serializer, and the note came back in the serializer's form. What is held
 * here: the part of a link that names the file changes, and every other
 * character of the note is the one that was there.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const rename = (note: string, renames: Record<string, string>) => renameNoteLinks(note, new Map(Object.entries(renames)));
/** `note` with every `from` replaced — the note the rename has to hand back. */
const swapped = (note: string, from: string, to: string) => note.split(from).join(to);
const windows = (note: string) => note.replace(/\n/g, "\r\n");

/** The four forms the finding names, plus what else the serializer writes its own way. */
const FOUR_FORMS = [
  "---",
  "title:   A",
  "tags: [a, b]",
  "---",
  "# A",
  "",
  "* item with [[Old]]",
  "* *emphasis* and __strong__",
  "+ another marker",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | [[Old]] |",
  "",
  "***",
  "",
  "1) one",
  "2) two",
  "",
  "Setext",
  "======",
  "",
  "    indented code",
  "",
  "last line without a line end",
].join("\n");

describe("the linking note comes back byte for byte but for the link target", () => {
  it("leaves list markers, emphasis marks, a table rule, the line behind the properties and the end of the file as they are", () => {
    const result = rename(FOUR_FORMS, { Old: "New" });
    expect(result).toEqual({ content: swapped(FOUR_FORMS, "[[Old]]", "[[New]]"), renamed: 2, unplaced: 0 });
    // The proof that this note is one the serializer rewrites: the way a
    // rename went until now changes each of the forms above.
    const serialized = serializeMarkdownAst(parseMarkdownAst(FOUR_FORMS, { preserveObsidianSyntax: true }));
    for (const form of ["* item", "*emphasis*", "|---|---|", "---\n# A", "***", "1) one", "======"]) expect(serialized, form).not.toContain(form);
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("keeps \\r\\n line ends and a byte order mark, and a mix of both line ends", () => {
    const note = MARK + windows(FOUR_FORMS);
    expect(rename(note, { Old: "New" })).toEqual({ content: swapped(note, "[[Old]]", "[[New]]"), renamed: 2, unplaced: 0 });
    const mixed = `${MARK}one [[Old]]\r\ntwo [[Old]]\nthree\r\n\r\n* [[Old]]\n`;
    expect(rename(mixed, { Old: "New" }).content).toBe(swapped(mixed, "Old", "New"));
  });

  const cases: Array<[what: string, note: string, renames: Record<string, string>, after: string]> = [
    ["a wiki link", "See [[Old]] here.", { Old: "New" }, "See [[New]] here."],
    ["an alias", "See [[Old|the old one]].", { Old: "New" }, "See [[New|the old one]]."],
    ["an anchor", "See [[Old#Heading]].", { Old: "New" }, "See [[New#Heading]]."],
    ["an anchor and an alias", "See [[Old#Heading|alias]].", { Old: "New" }, "See [[New#Heading|alias]]."],
    ["a block reference", "See [[Old^block]] and [[Old#^block]].", { Old: "New" }, "See [[New^block]] and [[New#^block]]."],
    ["an embed", "![[Old]] and ![[Old#Part|300]]", { Old: "New" }, "![[New]] and ![[New#Part|300]]"],
    ["blanks around the target", "[[ Old ]] and [[  Old  #H | alias ]]", { Old: "New" }, "[[ New ]] and [[  New  #H | alias ]]"],
    ["a target with a path", "[[Projects/Old]] and [[./Old]] and [[/Projects/Old#H]]", { "Projects/Old": "Projects/New", "./Old": "./New", "/Projects/Old": "/Projects/New" }, "[[Projects/New]] and [[./New]] and [[/Projects/New#H]]"],
    ["a Markdown link", "[the note](Old.md) and [again](Projects/Old.md)", { "Old.md": "New.md", "Projects/Old.md": "Projects/New.md" }, "[the note](New.md) and [again](Projects/New.md)"],
    ["a Markdown link with an anchor and a title", '[x](Old.md#Part%20One "a title") [y](Old.md#^block)', { "Old.md": "New.md" }, '[x](New.md#Part%20One "a title") [y](New.md#^block)'],
    ["only the links that name the file", "[[Old]] [[Older]] [[Not Old]] [[old]] [x](Old.md.bak)", { Old: "New" }, "[[New]] [[Older]] [[Not Old]] [[old]] [x](Old.md.bak)"],
    ["several files at once", "[[A]] [[B]] [c](C.md)", { A: "B", B: "C", "C.md": "A.md" }, "[[B]] [[C]] [c](A.md)"],
    ["a longer and a shorter name", "x [[Old]] y [[Old]] z", { Old: "A much longer name" }, "x [[A much longer name]] y [[A much longer name]] z"],
  ];
  it.each(cases)("%s", (_what, note, renames, after) => {
    expect(rename(note, renames).content).toBe(after);
    // The same note as it lies in a vault from Windows.
    expect(rename(MARK + windows(`# T\n\n${note}\n\n* a\n* b\n`), renames).content).toBe(MARK + windows(`# T\n\n${after}\n\n* a\n* b\n`));
  });

  it("hands back the very string where no link names the file, and after a second run", () => {
    const note = "See [[Other]] and `[[Old]]`.\n";
    expect(rename(note, { Old: "New" })).toEqual({ content: note, renamed: 0, unplaced: 0 });
    const once = rename("[[Old]] [x](Old.md)", { Old: "New", "Old.md": "New.md" });
    expect(once).toMatchObject({ content: "[[New]] [x](New.md)", renamed: 2 });
    // A plan that is applied again after an interruption finds nothing left to do.
    expect(rename(once.content, { Old: "New", "Old.md": "New.md" })).toEqual({ content: once.content, renamed: 0, unplaced: 0 });
    // A rename that changes nothing a link says (letter case of the file alone) writes nothing.
    expect(rename("[[old]]", { old: "old" })).toEqual({ content: "[[old]]", renamed: 0, unplaced: 0 });
  });
});

/**
 * The six cases the rename was held to while it changed a link in the tree
 * (`renameVaultLink`, ast-mutations.test.ts until 2026-10-12): the same notes,
 * the same answers — and now the whole note, not only that it contains them.
 */
describe("the cases the rewrite in the tree was held to", () => {
  it.each([
    ["a simple wikilink", "See [[Old File]] for more info.", { "Old File": "New/Path/File" }, "See [[New/Path/File]] for more info.", 1],
    ["an aliased wikilink keeps the alias", "See [[Old File|My Alias]] for more info.", { "Old File": "New File" }, "See [[New File|My Alias]] for more info.", 1],
    ["an embed", "Here is a picture: ![[image.png]]", { "image.png": "assets/image.png" }, "Here is a picture: ![[assets/image.png]]", 1],
    ["a standard markdown link", "See [My Alias](Old%20File.md) for more info.", { "Old File.md": "New File.md" }, "See [My Alias](New%20File.md) for more info.", 1],
    ["heading anchors on wikilinks, with and without alias", "See [[Old File#Intro]] and [[Old File#Intro|Alias]].", { "Old File": "New File" }, "See [[New File#Intro]] and [[New File#Intro|Alias]].", 2],
    ["anchors on markdown links", "See [section](Old%20File.md#intro).", { "Old File.md": "New File.md" }, "See [section](New%20File.md#intro).", 1],
  ] as Array<[string, string, Record<string, string>, string, number]>)("%s", (_what, note, renames, after, count) => {
    expect(rename(note, renames)).toEqual({ content: after, renamed: count, unplaced: 0 });
  });
});

describe("what is a link, and what only looks like one", () => {
  it("leaves code, HTML and the properties block alone — the index lists no link there either", () => {
    const note = [
      "---",
      'related: "[[Old]]"',
      "---",
      "`[[Old]]` in a code span",
      "",
      "```",
      "[[Old]] in a fence",
      "```",
      "",
      "    [[Old]] in indented code",
      "",
      "<div>[[Old]] in an HTML block</div>",
      "",
      "<!-- [[Old]] in a comment -->",
      "",
      "[ref]: Old.md",
      "",
      "<https://example.com/Old> https://example.com/Old.md",
      "",
    ].join("\n");
    expect(rename(note, { Old: "New", "Old.md": "New.md" })).toEqual({ content: note, renamed: 0, unplaced: 0 });
  });

  it("finds a link in every kind of text: a heading, a quote, a list, a footnote, between HTML tags", () => {
    const note = [
      "# Heading [[Old]]",
      "",
      "> a quote",
      "> with [[Old]] on its second line",
      "",
      "- item",
      "  continued [[Old]]",
      "  - deeper [[Old|alias]]",
      "    and deeper still ![[Old]]   ",
      "    last",
      "",
      "text[^1] *em [[Old]] em* **st [[Old]]** ~~del [[Old]]~~ <span>[[Old]]</span>",
      "",
      "[^1]: a footnote [[Old]]",
      "    with a second line [[Old]]",
      "",
      "> lazy",
      "[[Old]] continuation",
      "",
      "a\t[[Old]]\tb",
      "\tc [[Old]]",
      "",
    ].join("\n");
    for (const text of [note, windows(note), MARK + windows(note)]) {
      expect(rename(text, { Old: "New" })).toEqual({ content: swapped(text, "Old", "New"), renamed: 14, unplaced: 0 });
    }
  });

  it("keeps the backslash in front of the `|` of an aliased link in a table cell", () => {
    const table = "| note | state |\n|---|:-:|\n| [[Old\\|the old one]] | open |\n| [x](Old.md) and ![[Old\\|200]] | plain \\| pipe [[Old]] |\n";
    const after = "| note | state |\n|---|:-:|\n| [[New\\|the old one]] | open |\n| [x](New.md) and ![[New\\|200]] | plain \\| pipe [[New]] |\n";
    expect(rename(table, { Old: "New", "Old.md": "New.md" })).toEqual({ content: after, renamed: 4, unplaced: 0 });
    // While a rename wrote the tree back, the cell came out as `[[New|the old
    // one]]`: the bare `|` ended it, and the row had a cell more. A wiki link
    // is a node that holds what is written now, so a tree written back keeps
    // the backslash too — and still writes the table in its own form.
    const serialized = serializeMarkdownAst(parseMarkdownAst(table, { preserveObsidianSyntax: true }));
    expect(serialized).toContain("[[Old\\|the old one]]");
    expect(serialized).not.toContain("|---|:-:|");
  });

  it("takes what stands between the brackets as it is written: a backslash is a character of the name", () => {
    // Markdown reads `\(` as `(` and `\_` as `_`. A wiki link holds a file's
    // name, not Markdown: these name "Old \(1\)" and "My\_Note", which is
    // where a click on them leads. Until 2026-10-12 the index listed "Old (1)".
    const escaped = "[[Old \\(1\\)]] and [[My\\_Note|a]]";
    expect(rename(escaped, { "Old (1)": "New", My_Note: "New" })).toEqual({ content: escaped, renamed: 0, unplaced: 0 });
    expect(rename(escaped, { "Old \\(1\\)": "New (2)", "My\\_Note": "My_New_Note" }).content).toBe("[[New (2)]] and [[My_New_Note|a]]");
    // The one spelling besides the plain one: `\|`, the bar of a table cell,
    // is the bar — outside a table as well.
    expect(rename("[[Old\\|alias]]", { Old: "New" }).content).toBe("[[New\\|alias]]");
    // A bracket behind a backslash opens no link, and neither does one that is
    // spelled as a character reference.
    const none = "\\[[Old]] and [\\[Old]] and &#91;[Old]] and &#91;&#91;Old]]\n";
    expect(rename(none, { Old: "New" })).toEqual({ content: none, renamed: 0, unplaced: 0 });
    expect(readNoteLinks(none)).toEqual({ links: [], unplaced: [] });
    // The brackets that are written open one, whatever stands in front of
    // them: a `[` or a `!` by reference is text, a backslash behind a
    // backslash is one.
    expect(rename("&#91;[[Old]] and &#33;[[Old]] and \\\\[[Old]]\n", { Old: "New" })).toEqual({ content: "&#91;[[New]] and &#33;[[New]] and \\\\[[New]]\n", renamed: 3, unplaced: 0 });
    expect(readNoteLinks("&#33;[[Old]]").links.map((link) => link.type)).toEqual(["wikilink"]);
  });

  it("writes a wiki link's new name as the name it is, and reads it as the link it is", () => {
    // A wiki link holds a file's name, not Markdown. The marks of a name pair
    // up for Markdown — `__init__` is a word in bold —, and until 2026-10-12
    // the index listed no link then: no backlink, and the next rename left
    // such a link on the old name.
    const once = rename("See [[Old]] here.\n", { Old: "__init__" });
    expect(once).toEqual({ content: "See [[__init__]] here.\n", renamed: 1, unplaced: 0 });
    expect(rename(once.content, { __init__: "setup" })).toEqual({ content: "See [[setup]] here.\n", renamed: 1, unplaced: 0 });
    const reference = rename("See [[Old|x]] here.\n", { Old: "Tom &amp; Jerry" });
    expect(reference).toEqual({ content: "See [[Tom &amp; Jerry|x]] here.\n", renamed: 1, unplaced: 0 });
    expect(rename(reference.content, { "Tom &amp; Jerry": "Old" })).toEqual({ content: "See [[Old|x]] here.\n", renamed: 1, unplaced: 0 });
  });

  // Finding 2026-10-21: an overview named by its folder, `[[C# Notes/index]]`,
  // names `C` — there is no way to write that folder's name in a wiki link.
  it("leaves a wiki link as it is where its new name is one a wiki link cannot carry, and counts it", () => {
    const note = "See [[Old]] and ![[Old#Part|x]], and [the map](Old.md).\n";
    for (const name of ["C# Notes/index", "a|b", "x^y", "Old]", "a]]b", " New", "trail\\"]) {
      expect(rename(note, { Old: name }), name).toEqual({ content: note, renamed: 0, unplaced: 2 });
    }
    // A bracket inside a name is no such name: the tokenizer reads the link to its first `]]`.
    expect(rename(note, { Old: "Meeting [draft] notes" })).toEqual({ content: swapped(note, "[[Old", "[[Meeting [draft] notes"), renamed: 2, unplaced: 0 });
    // A Markdown link carries such a name: its destination is written so that it reads as the name.
    expect(rename(note, { Old: "C# Notes/index", "Old.md": "C# Notes/index.md" })).toEqual({
      content: "See [[Old]] and ![[Old#Part|x]], and [the map](C%23%20Notes/index.md).\n",
      renamed: 1,
      unplaced: 2,
    });
  });

  it("knows the names a wiki link can carry as they are written — by reading the link back", () => {
    for (const name of ["Map", "Projects/index", "__init__", "*Draft*", "Tom &amp; Jerry", "Old (1)", "Ärger über Öl", "Meeting [draft] notes", "[Archive]/index", "a]b", "back\\slash"]) {
      expect(wikiLinkCanName(name), name).toBe(true);
    }
    // A backslash at the end would take the bar of an alias for its own: `[[trail\|x]]` names `trail`.
    for (const name of ["", "C# Notes/index", "a|b", "x^y", "Old]", "a]]b", " lead", "trail ", "two\nlines", "trail\\"]) expect(wikiLinkCanName(name), name).toBe(false);
  });

  it("reads a character reference in a wiki link as the characters it is written with; in a destination it leaves the link unplaced", () => {
    // The link names "Old &amp; Co": what the line says, and where a click on
    // it leads. Until 2026-10-12 the index listed "Old & Co", and the link
    // could not be placed.
    const note = "[[Old &amp; Co]] and [[Old]] on one line\n[[Old]] on the next\n";
    expect(rename(note, { "Old & Co": "New" })).toEqual({ content: note, renamed: 0, unplaced: 0 });
    expect(rename(note, { "Old &amp; Co": "New" })).toEqual({ content: "[[New]] and [[Old]] on one line\n[[Old]] on the next\n", renamed: 1, unplaced: 0 });
    expect(rename(note, { Old: "New" })).toEqual({ content: "[[Old &amp; Co]] and [[New]] on one line\n[[New]] on the next\n", renamed: 2, unplaced: 0 });
    // A Markdown link's destination IS Markdown: `&amp;` reads as `&` there,
    // and the note does not spell the file's name. It is reported, and no
    // character moves.
    const link = "[x](Old&amp;Co.md)\n";
    expect(rename(link, { "Old&Co.md": "New.md" })).toEqual({ content: link, renamed: 0, unplaced: 1 });
    // A link that names another file is nobody's failure.
    expect(rename(link, { "Other.md": "New.md" })).toEqual({ content: link, renamed: 0, unplaced: 0 });
  });

  it("finds a link in text the parser has cut up after reading it", () => {
    // An address the tokenizer does not take for a link — in square brackets,
    // right behind an HTML tag or a character reference — is cut out of its
    // text afterwards, and the pieces around it say no longer where they
    // stand. A wiki link is no piece of that text: it has a place of its own.
    const cases = [
      "[[Old]] [john@example.com] and [www.example.com] and {http://example.com} ![[Old]]\n",
      "<b>www.example.com</b> [[Old]] and <i>john@example.com</i> [[Old|x]]\n",
      "x&#32;www.example.com [[Old]] and [[Old#H]]\n",
      "# Heading [www.example.com] [[Old]]\n",
      "*emphasis [john@example.com] [[Old]]* and **[www.example.com] [[Old^b]]**\n",
      "| a | b |\n|---|---|\n| [www.example.com] [[Old\\|x]] | [[Old]] [john@example.com] |\n",
      "> a quote [www.example.com]\n> with [[Old]] on its second line\n",
      "- [www.example.com] [[Old]]\r\n  [john@example.com] [[Old|next line]]\r\n",
    ];
    for (const note of cases) {
      const links = note.split("Old").length - 1;
      expect(rename(note, { Old: "New" }), note).toEqual({ content: swapped(note, "Old", "New"), renamed: links, unplaced: 0 });
    }
  });

  it("reads a link glued to an address the way the tokenizer does: whichever of the two it reads first", () => {
    // An address the tokenizer takes itself — `www.` behind a blank, `https://`
    // — starts further left than the link behind it and takes `[[Old` along:
    // that is no link, for the index and here.
    const taken: Array<[string, string, number]> = [
      ["www.example.com/[[Old]] and [[Old]]\n", "www.example.com/[[Old]] and [[New]]\n", 1],
      ["see https://example.com/[[Old]] and (https://example.com/[[Old]]) then [[Old|a]]\r\n", "see https://example.com/[[Old]] and (https://example.com/[[Old]]) then [[New|a]]\r\n", 1],
    ];
    // An address it does not take — `www.` behind a bracket, an HTML tag, a
    // character reference, a backtick — is cut out of the text afterwards. By
    // then the link behind it has been read: it is a link, and the address
    // ends in front of it. (Until 2026-10-12 the address took the link along
    // here too, because the link was looked for after the cut.)
    const read: Array<[string, string, number]> = [
      ["x&#32;www.example.com/[[Old]] then [[Old]]\n", "x&#32;www.example.com/[[New]] then [[New]]\n", 2],
      ["[www.example.com/[[Old]] [[Old]]]\n", "[www.example.com/[[New]] [[New]]]\n", 2],
      ["<b>www.example.com/[[Old]] and [[Old]]</b>\n", "<b>www.example.com/[[New]] and [[New]]</b>\n", 2],
      ["``www.example.com/[[Old|a]] and ![[Old|a]] and [[Old|a]]\r\n", "``www.example.com/[[New|a]] and ![[New|a]] and [[New|a]]\r\n", 3],
      ["[www.example.com/[[Old]]/more and [[Old]]\n", "[www.example.com/[[New]]/more and [[New]]\n", 2],
    ];
    for (const [note, renamed, count] of [...taken, ...read]) {
      expect(rename(note, { Old: "New" }), note).toEqual({ content: renamed, renamed: count, unplaced: 0 });
      // The links read are the ones the index lists.
      const indexed = extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true })).links.filter((link) => link.type !== "markdown-link");
      expect(readNoteLinks(note).links.map((link) => `${link.type} ${link.target}`), note).toEqual(indexed.map((link) => `${link.type} ${link.target}`));
      // A second run finds nothing left to do.
      expect(rename(renamed, { Old: "New" }), renamed).toEqual({ content: renamed, renamed: 0, unplaced: 0 });
    }
  });

  it("reads a note with two byte order marks the way the index does: the second is a character of its text", () => {
    // What a file has that was given a mark twice. The parser skips the first.
    const note = `${MARK}${MARK}[x](Old.md) and [[Old]]\n`;
    expect(rename(note, { "Old.md": "New.md", Old: "New" })).toEqual({ content: `${MARK}${MARK}[x](New.md) and [[New]]\n`, renamed: 2, unplaced: 0 });
    // Behind the second mark `---` opens no properties block: its links are links of the text.
    const fenced = `${MARK}${MARK}---\nrelated: "[[Old]]"\n---\nbody [[Old]] x\n`;
    const indexed = extractLinksAndTags(parseMarkdownAst(fenced, { preserveObsidianSyntax: true })).links.map((link) => `${link.type} ${link.target}`);
    expect(indexed).toEqual(["wikilink Old", "wikilink Old"]);
    expect(readNoteLinks(fenced).links.map((link) => `${link.type} ${link.target}`)).toEqual(indexed);
    expect(rename(fenced, { Old: "New" })).toEqual({ content: swapped(fenced, "Old", "New"), renamed: 2, unplaced: 0 });
    // The mark a line begins with further down is a character like any other.
    expect(rename(`# A\n${MARK}[[Old]]\n`, { Old: "New" })).toEqual({ content: `# A\n${MARK}[[New]]\n`, renamed: 1, unplaced: 0 });
  });

  it("is not held up by a character reference beside a link", () => {
    const note = "A &amp; B&nbsp;[[Old]] &copy; [[Old|x]] &lt;[[Old#H]]&gt; &#124; ![[Old]]\n";
    expect(rename(note, { Old: "New" })).toEqual({ content: swapped(note, "Old", "New"), renamed: 4, unplaced: 0 });
    // A reference that stands for a line break gives the text a line its source does not have.
    expect(rename("1. x\n   [[Old]] &#10; [[Old]]\n", { Old: "New" })).toEqual({ content: "1. x\n   [[New]] &#10; [[New]]\n", renamed: 2, unplaced: 0 });
  });
});

describe("the destination of a Markdown link", () => {
  it("is written the way it was: encoded, between angle brackets, or with its letters as they are", () => {
    // Plainva's own form.
    expect(rename("[x](My%20Note.md)", { "My Note.md": "My Letter (1).md" }).content).toBe("[x](My%20Letter%20%281%29.md)");
    // Between angle brackets a path stands as it is.
    expect(rename("[x](<My Note.md>)", { "My Note.md": "My Letter.md" }).content).toBe("[x](<My Letter.md>)");
    expect(rename("[x](<  My Note.md  > 'kept')", { "My Note.md": "My Letter.md" }).content).toBe("[x](<  My Letter.md  > 'kept')");
    // …unless the new name cannot stand there as it is, or the old one was encoded.
    expect(rename("[x](<My Note.md>)", { "My Note.md": "A#B <c>.md" }).content).toBe("[x](<A%23B%20%3Cc%3E.md>)");
    expect(rename("[x](<My%20Note.md>)", { "My Note.md": "My Letter.md" }).content).toBe("[x](<My%20Letter.md>)");
    // Other tools encode a blank and leave letters beyond ASCII alone.
    expect(rename("[x](Über%20uns.md)", { "Über uns.md": "Über mich (neu).md" }).content).toBe("[x](Über%20mich%20%28neu%29.md)");
    expect(rename("[x](Notes/Old.md)", { "Notes/Old.md": "Notes/Übersicht.md" }).content).toBe("[x](Notes/%C3%9Cbersicht.md)");
  });

  it("leaves the folders in front of the name as they are spelled", () => {
    // A rename leaves a file in its folder. Another tool's encoding of that
    // folder stays; only the name behind it is written anew.
    expect(rename("[x](Projects%20(old)/Old.md)", { "Projects (old)/Old.md": "Projects (old)/New Name.md" }).content).toBe("[x](Projects%20(old)/New%20Name.md)");
    expect(rename("[x](../a%20b/c%20d/Old.md#H)", { "../a b/c d/Old.md": "../a b/c d/New.md" }).content).toBe("[x](../a%20b/c%20d/New.md#H)");
    expect(rename("[x](<My Folder/Old.md>)", { "My Folder/Old.md": "My Folder/New One.md" }).content).toBe("[x](<My Folder/New One.md>)");
    // An escape in a folder's name stays an escape — in a destination, which
    // is Markdown. The wiki link beside it names the folder "My\_Folder", with
    // its backslash, and is not this file's.
    expect(rename("[[My\\_Folder/Old]] [x](a\\(b\\)/Old.md)", { "My_Folder/Old": "My_Folder/New", "a(b)/Old.md": "a(b)/New.md" }).content).toBe("[[My\\_Folder/Old]] [x](a\\(b\\)/New.md)");
    // A folder the new target names another way is written anew with it.
    expect(rename("[x](Sub%20(1)/Old.md) [[Sub/Old]]", { "Sub (1)/Old.md": "Projects/Sub (1)/New.md", "Sub/Old": "Projects/Sub/New" }).content).toBe("[x](Projects/Sub%20%281%29/New.md) [[Projects/Sub/New]]");
  });

  it("writes anew only the part of a name that changes", () => {
    // What two names begin and end with stays as it is spelled — another
    // tool's blank as `%20`, its brackets as they are, an escaped character.
    expect(rename("[x](Old%20Note%20(draft).md)", { "Old Note (draft).md": "New Note (draft).md" }).content).toBe("[x](New%20Note%20(draft).md)");
    expect(rename("[x](R%20(1)%20Old.md)", { "R (1) Old.md": "R (1) New.md" }).content).toBe("[x](R%20(1)%20New.md)");
    expect(rename("[[Report 2025]] [x](My\\_Report%202025.md)", { "Report 2025": "Report 2026", "My_Report 2025.md": "My_Report 2026.md" }).content).toBe("[[Report 2026]] [x](My\\_Report%202026.md)");
    // A letter written as two encoded bytes is one piece, and is replaced as one.
    expect(rename("[x](%C3%84%20Old.md)", { "Ä Old.md": "Ö Old.md" }).content).toBe("[x](%C3%96%20Old.md)");
    // A `%` that encodes nothing is a `%`.
    expect(rename("[x](<100% (a)/Old.md>)", { "100% (a)/Old.md": "100% (a)/New.md" }).content).toBe("[x](<100% (a)/New.md>)");
    // …and makes the reader take the whole destination as it stands, `%25`
    // included: where the spelling and the reading part like that, nothing of
    // the old destination is kept.
    expect(rename("[x](<50%25 off 100%/Old.md>)", { "50%25 off 100%/Old.md": "Sale/New.md" }).content).toBe("[x](<Sale/New.md>)");
  });

  it("keeps the label, the anchor, the title and everything around the destination", () => {
    const note = '[![a picture](pic.png)](Old.md) [](Old.md) [l *em* `c`](Old.md#H "t") [m]( Old.md ) [n](Old.md\n"a title\non two lines")\n';
    expect(rename(note, { "Old.md": "New.md" })).toEqual({ content: swapped(note, "Old.md", "New.md"), renamed: 5, unplaced: 0 });
    expect(rename("[p](a(b)c.md) [q](a\\)b.md) [r](./Old.md) [s](../Old.md)", { "a(b)c.md": "x.md", "a)b.md": "y.md", "./Old.md": "./New.md", "../Old.md": "../New.md" }).content)
      .toBe("[p](x.md) [q](y.md) [r](./New.md) [s](../New.md)");
  });

  it("takes an encoded `#` for part of the file's name, never for the start of an anchor", () => {
    const note = "[x](C%23%20Notes.md) [y](C%23%20Notes.md#Intro)";
    expect(rename(note, { C: "D" }).content).toBe(note);
    expect(rename(note, { "C# Notes.md": "D.md" }).content).toBe("[x](D.md) [y](D.md#Intro)");
  });

  it("rewrites the wiki link in a label and the destination behind it", () => {
    expect(rename("[see [[Old]]](Old.md)", { Old: "New", "Old.md": "New.md" })).toEqual({ content: "[see [[New]]](New.md)", renamed: 2, unplaced: 0 });
  });

  /** The file the first Markdown link of a note names, as the note is read. */
  const named = (note: string) => readNoteLinks(note).links.find((link) => link.type === "markdown-link")?.target;

  it("names the new file when the note is read again, whatever the name could be read as", () => {
    // A name that holds what Markdown reads as a character reference. The
    // encoding Plainva writes leaves `&` bare; here it has to be encoded.
    const cases: Array<[string, string, string, string]> = [
      ["[x](Old.md)\n", "Old.md", "Tips &amp; Tricks.md", "[x](Tips%20%26amp;%20Tricks.md)\n"],
      ["[x](<Old Note.md>)\n", "Old Note.md", "AT&amp;T.md", "[x](<AT%26amp;T.md>)\n"],
      // What the note keeps of the old name and what is written anew meet, and
      // read together they are something else: a reference, an encoded letter.
      ["[x](<R&D.md>)\n", "R&D.md", "R&amp;D.md", "[x](<R%26amp;D.md>)\n"],
      ["[x](<a&xlt;.md>)\n", "a&xlt;.md", "a&lt;.md", "[x](<a%26lt;.md>)\n"],
      ["[x](<50% Old.md>)\n", "50% Old.md", "50%41 Old.md", "[x](<50%2541%20Old.md>)\n"],
      ["[x](100%.md)\n", "100%.md", "100%25.md", "[x](100%2525.md)\n"],
      ["[x](100%zz.md)\n", "100%zz.md", "100%41zz.md", "[x](100%2541zz.md)\n"],
    ];
    for (const [note, from, to, renamed] of cases) {
      expect(named(note), note).toBe(from);
      expect(rename(note, { [from]: to }), note).toEqual({ content: renamed, renamed: 1, unplaced: 0 });
      expect(named(renamed), renamed).toBe(to);
    }
    // An `&` that begins no reference stays as it is written everywhere else,
    // and so does a `#` Plainva's encoding has made `%23` of.
    expect(rename("[x](Old.md)", { "Old.md": "R&D (new).md" }).content).toBe("[x](R&D%20%28new%29.md)");
    expect(named("[x](R&D%20%28new%29.md)")).toBe("R&D (new).md");
    expect(rename("[x](Old.md)", { "Old.md": "No&#35;1.md" }).content).toBe("[x](No&%2335;1.md)");
    expect(named("[x](No&%2335;1.md)")).toBe("No&#35;1.md");
  });
});

describe("the links as they are read", () => {
  it("says where a link and the part that names its file stand", () => {
    const note = `${MARK}# T\r\n\r\n> a [[ Old #H|x]]\r\n> b ![[Old]] [l](<Old.md> "t")\r\n`;
    const read = readNoteLinks(note);
    expect(read.unplaced).toEqual([]);
    expect(read.links.map((link) => [link.type, link.target, note.slice(link.start, link.end), note.slice(link.targetStart, link.targetEnd)])).toEqual([
      ["wikilink", "Old", "[[ Old #H|x]]", "Old"],
      ["embed", "Old", "![[Old]]", "Old"],
      ["markdown-link", "Old.md", '[l](<Old.md> "t")', "Old.md"],
    ]);
    expect(read.links.map((link) => link.angle)).toEqual([false, false, true]);
  });

  // Finding 2026-10-12: a wiki link in a label was turned into a Markdown link
  // by a caller that could not know where it stood, and the link around it was
  // text afterwards. The reader says so now.
  it("says which links stand in the label of another link", () => {
    const note = [
      "[[Plain]] and [see [[Inline]] and ![[Embedded]] here](Target.md)",
      "",
      "[by *reference [[Deep]]*][ref] and [[After]]",
      "",
      "| a |",
      "|---|",
      "| [in a cell [[Cell\\|c]]](<Target File.md>) [[Beside]] |",
      "",
      "[ref]: Target.md",
      "",
    ].join("\n");
    const read = readNoteLinks(note);
    expect(read.unplaced).toEqual([]);
    expect(read.links.map((link) => [note.slice(link.start, link.end), link.inLabel])).toEqual([
      ["[[Plain]]", false],
      // The link that holds the label is none in a label itself.
      ["[see [[Inline]] and ![[Embedded]] here](Target.md)", false],
      ["[[Inline]]", true],
      ["![[Embedded]]", true],
      // A link by reference shows a label too, and the mark around a link does not take it out of it.
      ["[[Deep]]", true],
      ["[[After]]", false],
      ["[in a cell [[Cell\\|c]]](<Target File.md>)", false],
      ["[[Cell\\|c]]", true],
      ["[[Beside]]", false],
    ]);
    // Where a link stands does not change what a rename does with it.
    expect(rename(note, { Inline: "Renamed", "Target.md": "Other.md" }).content).toBe(
      note.replace("[[Inline]]", "[[Renamed]]").replace("here](Target.md)", "here](Other.md)")
    );
  });

  it("replaces a whole link where a caller asks for that, and nothing around it", () => {
    const note = "- [[A]] and [[B|b]]\r\n- ![[A]]\r\n";
    const result = rewriteNoteLinks(note, (link) => (link.type === "wikilink" && link.target === "A" ? { replacement: "[A](A.md)" } : null));
    expect(result).toMatchObject({ content: "- [A](A.md) and [[B|b]]\r\n- ![[A]]\r\n", rewritten: 1 });
  });

  /**
   * The rewriter and the index read one text. The index lists a note's links
   * from the same tree (`extractLinksAndTags`, which feeds `links.target_path`
   * and so the backlinks a rename is planned from); a link the index lists and
   * the rewriter does not find would keep naming the old file. The one kind
   * the rewriter leaves out names no file: an address written as a link of its
   * own, `<https://…>` or bare.
   */
  const fixtures = dirname(fileURLToPath(import.meta.url)) + "/fixtures";
  const corpus: Array<[string, string]> = [
    ...readdirSync(fixtures).filter((name) => name.endsWith(".md")).map((name): [string, string] => [name, readFileSync(join(fixtures, name), "utf8")]),
    ["the four forms", FOUR_FORMS],
    ["windows", MARK + windows(FOUR_FORMS)],
    ["links of every kind", "[[A]] [[B|b]] [[C#h]] [[D^e]] ![[E.png|100]] [[ F ]] [[#only an anchor]] [g](G.md) [h](H%20I.md#J) [k](<K L.md>) [m](https://example.com) <https://example.com> [[N\\|n]] `[[O]]` [p][q]\n\n[q]: Q.md\n"],
    ["a table", "| a |\n|---|\n| [[A\\|a]] [b](B.md) ![[C]] |\n"],
    ["escapes and references", "\\[[A]] [\\[B]] [[C \\(1\\)]] [[D &amp; E]] [[F&#124;f]] [[_g_]] [[__h__]] [[i_j_k]]\n"],
    ["names and aliases Markdown reads something into", "[[_a_]] [[__b__]] [[*c*]] [[~~d~~]] [[E|*the* alias]] [[F|a `code` alias]] [[_g]] and [[h_]] ![[_i_|100]] [[J &amp; K]] [[<l>]] [[m@n.oo]] [[www.p.com]]\n\n| t |\n|---|\n| [[_q_\\|*r*]] |\n"],
    ["a link glued to what Markdown would make a link of", "[[1]](https://example.com) [[S]][ref] [[ref]] [[^1]] text[^1]\n\n[ref]: https://example.com\n[^1]: note\n"],
    ["a label with a link in it", "[see [[A]] and ![[B]]](C.md)\n"],
    ["text the parser cut up after reading", "[[A]] [john@example.com] [www.example.com] {http://example.com} [[B]]\n\n<b>www.example.com</b> [[C]]\n\n# H [www.example.com] [[D]]\n\nx&#32;www.example.com [[E|e]] ![[F]]\n"],
  ];
  it.each(corpus)("lists the links the index lists: %s", (_name, text) => {
    const indexed = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true })).links.map((link) => `${link.type} ${link.target}`);
    const read = readNoteLinks(text);
    const listed = [...read.links, ...read.unplaced].map((link) => `${link.type} ${link.target}`);
    // Every link the rewriter reads is one the index lists…
    const left = [...indexed];
    for (const link of listed) {
      const at = left.indexOf(link);
      expect(at, `${link} is not in the index`).toBeGreaterThan(-1);
      left.splice(at, 1);
    }
    // …and what the index lists beyond those is an address (`https://…`, `mailto:…`), never a file.
    for (const link of left) expect(link).toMatch(/^markdown-link [a-z][a-z0-9+.-]*:/);
  });

  it("stays linear in a long note", () => {
    const lines: string[] = [];
    for (let i = 0; i < 3_000; i++) lines.push(`- line ${i} with [[Old]], [[Other ${i}|alias]] and [a link](Old.md) \\[ [ [[`);
    const note = lines.join("\n");
    const started = Date.now();
    const result = rename(note, { Old: "New", "Old.md": "New.md" });
    expect(result.renamed).toBe(6_000);
    expect(result.content).toBe(swapped(swapped(note, "[[Old]]", "[[New]]"), "(Old.md)", "(New.md)"));
    // Parsing dominates; a rewrite that searched the note again for every link would not get here.
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
