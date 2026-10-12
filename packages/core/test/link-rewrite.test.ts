import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { readNoteLinks, renameNoteLinks, rewriteNoteLinks } from "../src/linkRewrite.js";
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
    // Until now the cell came back as `[[New|the old one]]`: the bare `|` ended it, and the row had a cell more.
    const serialized = serializeMarkdownAst(parseMarkdownAst(table, { preserveObsidianSyntax: true }));
    expect(serialized).toContain("[[Old|the old one]]");
  });

  it("reads a backslash escape the way the parser does, and writes the link back around it", () => {
    // The parser takes `\(` for `(`: the index lists the file `Old (1)`.
    expect(rename("[[Old \\(1\\)]] and [[Old \\(1\\)#H|a]]", { "Old (1)": "New" }).content).toBe("[[New]] and [[New#H|a]]");
    // An escaped bracket in front of the link, and inside its opening.
    expect(rename("\\[[Old]] and [\\[Old]]", { Old: "New" }).content).toBe("\\[[New]] and [\\[New]]");
    // `\|` outside a table is the same separator.
    expect(rename("[[Old\\|alias]]", { Old: "New" }).content).toBe("[[New\\|alias]]");
    // A character the note escapes in the old name is escaped in the new one:
    // left bare, a `_` can pair up with one further on, and the link is none.
    expect(rename("[[My\\_Note]] and [[My\\_Note|a]]", { My_Note: "My_New_Note (2)" }).content).toBe("[[My\\_New\\_Note (2)]] and [[My\\_New\\_Note (2)|a]]");
    expect(rename("[[Old \\(1\\)]]", { "Old (1)": "New (2)" }).content).toBe("[[New \\(2\\)]]");
  });

  it("writes a wiki link's new name as the name it is", () => {
    // As the rewrite in the tree did: a wiki link holds a file's name, not
    // Markdown, and a backslash in it would be part of the name for every
    // reader that takes it so. The index scans Markdown text, though, and
    // lists no link where the marks of a name pair up — the same as for a
    // link somebody typed that way. That is the scan's to put right, not this
    // rewrite's to cover by spelling a name another way.
    expect(rename("See [[Old]] here.\n", { Old: "__init__" })).toEqual({ content: "See [[__init__]] here.\n", renamed: 1, unplaced: 0 });
    expect(rename("See [[Old|x]] here.\n", { Old: "Tom &amp; Jerry" })).toEqual({ content: "See [[Tom &amp; Jerry|x]] here.\n", renamed: 1, unplaced: 0 });
  });

  it("does not guess at a link with a character reference in it: it is reported, and no character moves", () => {
    // `&amp;` is read as `&`, so the index lists the file `Old & Co` — which the note does not spell.
    const note = "[[Old &amp; Co]] and [[Old]] on one line\n[[Old]] on the next\n";
    expect(rename(note, { "Old & Co": "New" })).toEqual({ content: note, renamed: 0, unplaced: 1 });
    // The links beside it are found where they stand.
    expect(rename(note, { Old: "New" })).toEqual({ content: "[[Old &amp; Co]] and [[New]] on one line\n[[New]] on the next\n", renamed: 2, unplaced: 0 });
    // A destination with a reference in it.
    const link = "[x](Old&amp;Co.md)\n";
    expect(rename(link, { "Old&Co.md": "New.md" })).toEqual({ content: link, renamed: 0, unplaced: 1 });
    // A link that names another file is nobody's failure.
    expect(rename(note, { Other: "New" })).toEqual({ content: note, renamed: 0, unplaced: 0 });
    // A reference that opens a link the source does not spell: `&#91;` is read as `[`.
    const spelled = "&#91;[Old]] and [[Old]]\n";
    expect(rename(spelled, { Old: "New" })).toEqual({ content: "&#91;[Old]] and [[New]]\n", renamed: 1, unplaced: 1 });
  });

  it("finds a link in text the parser has cut up after reading it", () => {
    // An address the tokenizer does not take for a link — in square brackets,
    // right behind an HTML tag or a character reference — is cut out of its
    // text afterwards, and the pieces around it say no longer where they stand.
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

  it("leaves an address alone that ends in what looks like a link, and finds the link behind it", () => {
    // Cut out of its text after reading, such an address takes `[[Old` along
    // and leaves `]]` to the text behind it. For the index that is no link —
    // and the source spells it exactly like the one that follows.
    const cases: Array<[string, string]> = [
      ["x&#32;www.example.com/[[Old]] then [[Old]]\n", "x&#32;www.example.com/[[Old]] then [[New]]\n"],
      ["[www.example.com/[[Old]] [[Old]]]\n", "[www.example.com/[[Old]] [[New]]]\n"],
      ["<b>www.example.com/[[Old]] and [[Old]]</b>\n", "<b>www.example.com/[[Old]] and [[New]]</b>\n"],
      ["``www.example.com/[[Old|a]] and ![[Old|a]] and [[Old|a]]\r\n", "``www.example.com/[[Old|a]] and ![[New|a]] and [[New|a]]\r\n"],
      ["[[Old]] [www.example.com/[[Old]] [[Old]] [www.example.com/[[Old]] [[Old]]\n", "[[New]] [www.example.com/[[Old]] [[New]] [www.example.com/[[Old]] [[New]]\n"],
    ];
    for (const [note, renamed] of cases) {
      expect(rename(note, { Old: "New" }), note).toEqual({ content: renamed, renamed: renamed.split("New").length - 1, unplaced: 0 });
      // The links read are the ones the index lists: none of them in the address.
      const indexed = extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true })).links.filter((link) => link.type !== "markdown-link");
      expect(readNoteLinks(note).links.map((link) => `${link.type} ${link.target}`), note).toEqual(indexed.map((link) => `${link.type} ${link.target}`));
      // A second run finds nothing left to do.
      expect(rename(renamed, { Old: "New" }), renamed).toEqual({ content: renamed, renamed: 0, unplaced: 0 });
    }
    // An address the tokenizer takes itself says where it stands, and so does the text around it.
    expect(rename("www.example.com/[[Old]] and [[Old]]\n", { Old: "New" })).toEqual({ content: "www.example.com/[[Old]] and [[New]]\n", renamed: 1, unplaced: 0 });
    // Where the whole link lies inside the address, the index lists it, and it follows the rename.
    expect(rename("[www.example.com/[[Old]]/more and [[Old]]\n", { Old: "New" })).toEqual({ content: "[www.example.com/[[New]]/more and [[New]]\n", renamed: 2, unplaced: 0 });
  });

  it("changes nothing at a place that only looks like the link: a reference in front of it makes it another one", () => {
    // `&#91;` is read as `[`: for the parser the first link names "[Old". The
    // second is the link to Old, and the only one that follows the rename.
    expect(rename("&#91;[[Old]] and [[Old]]\n", { Old: "New" })).toEqual({ content: "&#91;[[Old]] and [[New]]\n", renamed: 1, unplaced: 0 });
    // `&#33;` is read as `!`: the first is an embed of Old the source does not spell as one.
    expect(rename("&#33;[[Old]] and [[Old]]\n", { Old: "New" })).toEqual({ content: "&#33;[[Old]] and [[New]]\n", renamed: 1, unplaced: 1 });
    expect(rename("&#33;[[Old]] and [[New]]\n", { Old: "New" })).toEqual({ content: "&#33;[[Old]] and [[New]]\n", renamed: 0, unplaced: 1 });
    // A link the source does not spell at all, in front of one it spells for
    // another file: the place that is spelled `[[Old]]` is no link to Old.
    const neither = "&#91;&#91;Old]] and &#91;[[Old]]\n";
    expect(rename(neither, { Old: "New" })).toEqual({ content: neither, renamed: 0, unplaced: 1 });
    const read = readNoteLinks(neither);
    expect(read.links).toEqual([]);
    expect(read.unplaced.map((link) => `${link.type} ${link.target}`).sort()).toEqual(["wikilink Old", "wikilink [Old"]);
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
    // An escape in a folder's name stays an escape.
    expect(rename("[[My\\_Folder/Old]] [x](a\\(b\\)/Old.md)", { "My_Folder/Old": "My_Folder/New", "a(b)/Old.md": "a(b)/New.md" }).content).toBe("[[My\\_Folder/New]] [x](a\\(b\\)/New.md)");
    // A folder the new target names another way is written anew with it.
    expect(rename("[x](Sub%20(1)/Old.md) [[Sub/Old]]", { "Sub (1)/Old.md": "Projects/Sub (1)/New.md", "Sub/Old": "Projects/Sub/New" }).content).toBe("[x](Projects/Sub%20%281%29/New.md) [[Projects/Sub/New]]");
  });

  it("writes anew only the part of a name that changes", () => {
    // What two names begin and end with stays as it is spelled — another
    // tool's blank as `%20`, its brackets as they are, an escaped character.
    expect(rename("[x](Old%20Note%20(draft).md)", { "Old Note (draft).md": "New Note (draft).md" }).content).toBe("[x](New%20Note%20(draft).md)");
    expect(rename("[x](R%20(1)%20Old.md)", { "R (1) Old.md": "R (1) New.md" }).content).toBe("[x](R%20(1)%20New.md)");
    expect(rename("[[Report 2025]] [[My\\_Report 2025|r]]", { "Report 2025": "Report 2026", "My_Report 2025": "My_Report 2026" }).content).toBe("[[Report 2026]] [[My\\_Report 2026|r]]");
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
