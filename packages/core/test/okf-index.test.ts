import { describe, it, expect } from "vitest";
import {
  generateIndexContent,
  findIndexCandidates,
  relativeMarkdownUrl,
  convertWikilinksToMarkdownLinks,
} from "../src/okf-index.js";
import { readNoteLinks } from "../src/linkRewrite.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed } from "../src/vault/LinkResolver.js";

describe("relativeMarkdownUrl", () => {
  it("builds relative urls from a folder", () => {
    expect(relativeMarkdownUrl("Projects", "Projects/Note.md")).toBe("Note.md");
    expect(relativeMarkdownUrl("Projects", "Projects/Sub/Note.md")).toBe("Sub/Note.md");
    expect(relativeMarkdownUrl("Projects", "Other/Note.md")).toBe("../Other/Note.md");
    expect(relativeMarkdownUrl("", "Note File.md")).toBe("Note%20File.md");
  });
});

describe("generateIndexContent", () => {
  it("produces a spec-shaped listing with descriptions and subfolders", () => {
    const content = generateIndexContent({
      folder: "Projects",
      heading: "Projects",
      files: [
        { path: "Projects/Beta.md", title: "Beta", description: "Second project." },
        { path: "Projects/Alpha.md" },
      ],
      subfolders: [
        { name: "Archive", description: "Old stuff.", hasIndex: true },
        { name: "Scratch" }, // no index.md of its own
      ],
      subfoldersHeading: "Ordner",
    });

    expect(content).toBe(
      [
        "# Projects",
        "",
        "* [Alpha](Alpha.md)",
        "* [Beta](Beta.md) - Second project.",
        "",
        "# Ordner",
        "",
        // A subfolder WITH its own index.md links straight to it (opens in
        // Plainva AND Obsidian). Without one, a plain entry avoids fabricating a
        // stray note on click in Obsidian (Issue #9).
        "* [Archive](Archive/index.md) - Old stuff.",
        "* Scratch",
        "",
      ].join("\n")
    );
  });

  it("url-encodes a linked subfolder and points at its index.md (Issue #9)", () => {
    const content = generateIndexContent({
      folder: "",
      heading: "Vault",
      files: [],
      subfolders: [{ name: "1 Markdown handbook", hasIndex: true }],
      subfoldersHeading: "Ordner",
    });
    // Exactly the reporter's folder: the old `1%20Markdown%20handbook/` form
    // has no target in Obsidian, so clicking it created a stray note.
    expect(content).toContain("* [1 Markdown handbook](1%20Markdown%20handbook/index.md)");
    expect(content).not.toContain("(1%20Markdown%20handbook/)");
  });

  it("adds okf_version frontmatter only for the bundle root", () => {
    const root = generateIndexContent({
      folder: "",
      heading: "Vault",
      files: [{ path: "a.md" }],
      subfolders: [],
      bundleRoot: true,
    });
    expect(root.startsWith('---\nokf_version: "0.2"\n---\n')).toBe(true);

    const sub = generateIndexContent({
      folder: "Sub",
      heading: "Sub",
      files: [],
      subfolders: [],
    });
    expect(sub.startsWith("---")).toBe(false);
  });
});

describe("findIndexCandidates", () => {
  it("ranks folder notes and overview names, skipping index.md itself", () => {
    const candidates = findIndexCandidates("Projects", [
      "Projects.md",
      "MOC.md",
      "Übersicht.md",
      "Projekt MOC Liste.md",
      "index.md",
      "Random.md",
      "Democracy.md",
    ]);
    expect(candidates.map((c) => c.path)).toEqual([
      "Projects/Projects.md",
      "Projects/MOC.md",
      "Projects/Übersicht.md",
      "Projects/Projekt MOC Liste.md",
    ]);
    expect(candidates[0].reason).toBe("folder-note");
    // "Democracy" must not match the MOC pattern (word boundary).
    expect(candidates.some((c) => c.path.includes("Democracy"))).toBe(false);
  });

  it("matches english and german overview names at the vault root", () => {
    const candidates = findIndexCandidates("", ["Overview.md", "Start.md", "Note.md"]);
    expect(candidates.map((c) => c.path)).toEqual(["Overview.md", "Start.md"]);
  });
});

describe("convertWikilinksToMarkdownLinks", () => {
  const allFiles = ["Projects/Alpha.md", "Projects/Beta Note.md", "Other/Gamma.md"];

  it("converts wikilinks to relative markdown links, keeping aliases and anchors", () => {
    const md = "See [[Alpha]] and [[Beta Note|Beta]] and [[Gamma#Intro]].";
    const { content: out, result } = convertWikilinksToMarkdownLinks(md, {
      sourcePath: "Projects/MOC.md",
      allFilePaths: allFiles,
    });

    expect(result.converted).toBe(3);
    expect(out).toContain("[Alpha](Alpha.md)");
    expect(out).toContain("[Beta](Beta%20Note.md)");
    expect(out).toContain("[Gamma#Intro](../Other/Gamma.md#Intro)");
    // …and nothing around the links moves.
    expect(out).toBe("See [Alpha](Alpha.md) and [Beta](Beta%20Note.md) and [Gamma#Intro](../Other/Gamma.md#Intro).");
  });

  it("leaves embeds and unresolved targets untouched", () => {
    const md = "Embed ![[Alpha]] and missing [[Nowhere]].";
    const { content: out, result } = convertWikilinksToMarkdownLinks(md, {
      sourcePath: "Projects/MOC.md",
      allFilePaths: allFiles,
    });

    expect(result).toEqual({ converted: 0, embeds: 1, unresolved: 1, inLabels: 0 });
    expect(out).toContain("![[Alpha]]");
    expect(out).toContain("[[Nowhere]]");
    // Nothing to convert: the very text that was handed in.
    expect(out).toBe(md);
  });

  // Finding 2026-10-09: the note was written back from its parsed tree, so
  // preparing an overview reformatted all of it. Each link is replaced where it
  // stands; every other character is the one that was there.
  it("changes the converted links and nothing else — byte for byte", () => {
    const mark = String.fromCharCode(0xfeff);
    const note = [
      "# Map",
      "",
      "* item with [[Alpha]]",
      "* *emphasis* and __strong__ [[Nowhere]]",
      "",
      "| note | what |",
      "|---|---|",
      "| [[Beta Note\\|the second]] | ![[Alpha]] |",
      "",
      "***",
      "",
      "1) [[Gamma#Intro|a*b]]",
      "2) `[[Alpha]]` stays code",
      "",
      "last line without a line end [[Alpha|a [b] c]]",
    ].join("\n");
    const expected = note
      .replace("[[Alpha]]", "[Alpha](Alpha.md)")
      // In a table cell the `|` of an alias was `\|`; the link that takes its place needs none.
      .replace("[[Beta Note\\|the second]]", "[the second](Beta%20Note.md)")
      // A label is written so that it reads as the text it is.
      .replace("[[Gamma#Intro|a*b]]", "[a\\*b](../Other/Gamma.md#Intro)")
      .replace("[[Alpha|a [b] c]]", "[a \\[b\\] c](Alpha.md)");
    for (const [text, after] of [[note, expected], [mark + note.replace(/\n/g, "\r\n"), mark + expected.replace(/\n/g, "\r\n")]]) {
      const { content, result } = convertWikilinksToMarkdownLinks(text, { sourcePath: "Projects/MOC.md", allFilePaths: allFiles });
      expect(content).toBe(after);
      expect(result).toEqual({ converted: 4, embeds: 1, unresolved: 1, inLabels: 0 });
    }
  });

  it("writes a `|` in a table cell so that it stays in the cell", () => {
    const table = "| a |\n|---|\n| [[Alpha\\|one \\| two]] |\n";
    const { content } = convertWikilinksToMarkdownLinks(table, { sourcePath: "Projects/MOC.md", allFilePaths: allFiles });
    expect(content).toBe("| a |\n|---|\n| [one \\| two](Alpha.md) |\n");
  });

  it("reads a character reference in a wiki link as the characters it is written with", () => {
    // The link names "Alpha &amp; Co", as the line spells it (finding 2026-10-11) —
    // not the note "Alpha & Co", which it was taken for until then.
    const note = "[[Alpha &amp; Co]] and ![[Alpha &amp; Co]]\n";
    expect(convertWikilinksToMarkdownLinks(note, { sourcePath: "Projects/MOC.md", allFilePaths: [...allFiles, "Projects/Alpha & Co.md"] })).toEqual({ content: note, result: { converted: 0, embeds: 1, unresolved: 1, inLabels: 0 } });
    // The Markdown link is written so that it reads as that name: `\&` keeps `&amp;` from being read as `&`.
    const converted = convertWikilinksToMarkdownLinks(note, { sourcePath: "Projects/MOC.md", allFilePaths: [...allFiles, "Projects/Alpha &amp; Co.md"] });
    expect(converted).toEqual({
      content: "[Alpha \\&amp; Co](Alpha%20\\&amp;%20Co.md) and ![[Alpha &amp; Co]]\n",
      result: { converted: 1, embeds: 1, unresolved: 0, inLabels: 0 },
    });
    expect(readNoteLinks(converted.content).links.map((link) => link.target)).toEqual(["Alpha &amp; Co.md", "Alpha &amp; Co"]);
    // The bar in an alias is the bar it spells, `\|` as well: the label reads "a|b".
    expect(convertWikilinksToMarkdownLinks("[[Alpha|a\\|b]]\n", { sourcePath: "Projects/MOC.md", allFilePaths: allFiles }).content).toBe("[a|b](Alpha.md)\n");
  });

  it("converts a link where the tokenizer reads it: behind an address it did not take, and behind a character reference", () => {
    const options = { sourcePath: "Projects/MOC.md", allFilePaths: allFiles };
    // An address behind a bracket is cut out of the text only after the link behind it was read.
    expect(convertWikilinksToMarkdownLinks("[www.example.com/[[Alpha]] [[Alpha]]]\n", options)).toEqual({
      content: "[www.example.com/[Alpha](Alpha.md) [Alpha](Alpha.md)]\n",
      result: { converted: 2, embeds: 0, unresolved: 0, inLabels: 0 },
    });
    // `&#33;` is a `!` by reference — text; the link behind it is no embed.
    expect(convertWikilinksToMarkdownLinks("&#33;[[Alpha]] and [[Alpha]]\n", options)).toEqual({
      content: "&#33;[Alpha](Alpha.md) and [Alpha](Alpha.md)\n",
      result: { converted: 2, embeds: 0, unresolved: 0, inLabels: 0 },
    });
  });

  // One rule for where a link leads (2026-10-09): the link is resolved over the
  // WHOLE vault and converted only where it leads to a note a listing may point
  // at. Resolved over those notes alone, `[[Brief]]` became a link to ANOTHER
  // `Brief.md` whenever the file it means is not one of them.
  it("resolves over the whole vault and converts only a link that leads to a listed note", () => {
    const vault = [
      { path: "Brief.md", title: "Brief" },
      { path: "Projects/Archiv/Brief.md", title: "Brief" },
      { path: "Projects/Alpha.md", title: "Alpha" },
      { path: "Daten/Aufgaben.base", title: "Aufgaben.base" },
    ];
    // A listing leaves the root's `Brief.md` out; the link leads there all the same.
    const only = new Set(["Projects/Archiv/Brief.md", "Projects/Alpha.md"]);
    const { content: out, result } = convertWikilinksToMarkdownLinks("See [[Brief]], [[Alpha]] and [[Aufgaben.base]].", { sourcePath: "Projects/MOC.md", allFilePaths: vault, only });

    expect(result).toEqual({ converted: 1, embeds: 0, unresolved: 2, inLabels: 0 });
    expect(out).toContain("[[Brief]]");
    expect(out).not.toContain("Archiv/Brief.md");
    expect(out).toContain("[Alpha](Alpha.md)");
    expect(out).toContain("[[Aufgaben.base]]");
  });

  // Finding 2026-10-12: `[see [[Alpha]] here](Beta%20Note.md)` came back as a
  // Markdown link inside a Markdown link. Links do not nest: the outer one was
  // text afterwards, and the link to the other note was gone without a word.
  it("leaves a wikilink in the label of a link as it is, and counts it", () => {
    const note = [
      "* [see [[Alpha]] here](Beta%20Note.md) and [[Alpha]] beside it",
      "* [by *reference [[Alpha|a]]*][g]",
      "",
      "| a |",
      "|---|",
      "| [in a cell [[Alpha\\|a]]](../Other/Gamma.md) |",
      "",
      "[g]: ../Other/Gamma.md",
      "",
    ].join("\r\n");
    const { content, result } = convertWikilinksToMarkdownLinks(note, { sourcePath: "Projects/MOC.md", allFilePaths: allFiles });

    expect(content).toBe(note.replace("[[Alpha]] beside it", "[Alpha](Alpha.md) beside it"));
    expect(result).toEqual({ converted: 1, embeds: 0, unresolved: 0, inLabels: 3 });
    // The links around them are the links they were: each still names its file.
    const links = (text: string) => readNoteLinks(text).links.filter((link) => link.type === "markdown-link").map((link) => link.target);
    expect(links(content)).toEqual(["Beta Note.md", "Alpha.md", "../Other/Gamma.md"]);
    expect(links(note)).toEqual(["Beta Note.md", "../Other/Gamma.md"]);
  });

  it("counts a wikilink in a label once, whether or not it leads anywhere", () => {
    const { content, result } = convertWikilinksToMarkdownLinks("[to [[Nowhere]]](Alpha.md) and [[Nowhere]]\n", { sourcePath: "Projects/MOC.md", allFilePaths: allFiles });
    expect(content).toBe("[to [[Nowhere]]](Alpha.md) and [[Nowhere]]\n");
    expect(result).toEqual({ converted: 0, embeds: 0, unresolved: 1, inLabels: 1 });
  });

  // Finding 2026-10-12: adopted as `index.md`, a note's links to itself were
  // converted to its OLD name, and the rename that followed looked for wiki
  // links it no longer held — they named a file that was gone.
  describe("a link of the document to itself", () => {
    const vault = [
      { path: "index.md", title: "index" },
      { path: "Projects/Map.md", title: "Projects Map" },
      { path: "Projects/Alpha.md", title: "Alpha" },
      { path: "Other/Gamma.md", title: "Gamma" },
    ];
    const note = "# Map\n\n[[Map]], [[Map#Part One|here]], [[Projects/Map#Part One]], [[Projects Map]] and ![[Map]] beside [[Alpha]] and [[Gamma]].\n";

    it("names the path the document is about to take, from its own folder, and keeps its label", () => {
      const { content, result } = convertWikilinksToMarkdownLinks(note, { sourcePath: "Projects/Map.md", becomes: "Projects/index.md", allFilePaths: vault });
      expect(content).toBe(
        "# Map\n\n[Map](./index.md), [here](./index.md#Part%20One), [Projects/Map#Part One](./index.md#Part%20One), [Projects Map](./index.md) and ![[Map]] beside [Alpha](Alpha.md) and [Gamma](../Other/Gamma.md).\n"
      );
      expect(result).toEqual({ converted: 6, embeds: 1, unresolved: 0, inLabels: 0 });
      // Read as the index reads them once the note lies there, every one of
      // them is the note itself — though the vault's root holds an `index.md` too.
      const after = buildLinkTargetIndex(vault.map((file) => (file.path === "Projects/Map.md" ? "Projects/index.md" : file.path)));
      const own = readNoteLinks(content).links.filter((link) => link.target === "./index.md");
      expect(own).toHaveLength(4);
      for (const link of own) expect(resolveLinkTargetIndexed("Projects/index.md", link.target, after)).toBe("Projects/index.md");
      // The rule takes a bare `index.md` for the file at that vault path first: the root's.
      expect(resolveLinkTargetIndexed("Projects/index.md", "index.md", after)).toBe("index.md");
    });

    it("is written from the folder the document moves to, like every other link", () => {
      const { content } = convertWikilinksToMarkdownLinks("[[Map]] [[Alpha]] [[Gamma]]\n", { sourcePath: "Projects/Map.md", becomes: "Other/Deep/index.md", allFilePaths: vault });
      expect(content).toBe("[Map](./index.md) [Alpha](../../Projects/Alpha.md) [Gamma](../Gamma.md)\n");
    });

    it("names the document itself where it stays what it is called", () => {
      expect(convertWikilinksToMarkdownLinks("[[Map]] and [[Alpha]]\n", { sourcePath: "Projects/Map.md", allFilePaths: vault }).content).toBe("[Map](./Map.md) and [Alpha](Alpha.md)\n");
      // At the vault's root, and with a name that has to be encoded.
      const root = ["My Home.md", "Alpha.md"];
      expect(convertWikilinksToMarkdownLinks("[[My Home]] and [[Alpha]]\n", { sourcePath: "My Home.md", becomes: "index.md", allFilePaths: root }).content).toBe("[My Home](./index.md) and [Alpha](Alpha.md)\n");
      expect(convertWikilinksToMarkdownLinks("[[My Home#A (b)|there]]\n", { sourcePath: "My Home.md", allFilePaths: root }).content).toBe("[there](./My%20Home.md#A%20%28b%29)\n");
    });

    it("is one only where the link leads to the document, not where it is merely called like it", () => {
      // `[[Map]]` in another folder's note of that name is the note beside it; from elsewhere it is the nearest.
      const two = [...vault, { path: "Other/Map.md", title: "Map" }];
      expect(convertWikilinksToMarkdownLinks("[[Map]] [[Projects/Map]]\n", { sourcePath: "Other/Map.md", becomes: "Other/index.md", allFilePaths: two }).content).toBe("[Map](./index.md) [Map](../Projects/Map.md)\n");
    });
  });
});
