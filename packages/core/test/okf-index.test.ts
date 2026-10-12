import { describe, it, expect } from "vitest";
import {
  generateIndexContent,
  findIndexCandidates,
  relativeMarkdownUrl,
  convertWikilinksToMarkdownLinks,
} from "../src/okf-index.js";

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

    expect(result).toEqual({ converted: 0, embeds: 1, unresolved: 1 });
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
      expect(result).toEqual({ converted: 4, embeds: 1, unresolved: 1 });
    }
  });

  it("writes a `|` in a table cell so that it stays in the cell", () => {
    const table = "| a |\n|---|\n| [[Alpha\\|one \\| two]] |\n";
    const { content } = convertWikilinksToMarkdownLinks(table, { sourcePath: "Projects/MOC.md", allFilePaths: allFiles });
    expect(content).toBe("| a |\n|---|\n| [one \\| two](Alpha.md) |\n");
  });

  it("counts a link whose place cannot be told as not converted, and leaves it", () => {
    // `&amp;` is read as `&`: the link names `Alpha & Co`, which the line does not spell.
    const note = "[[Alpha &amp; Co]] and ![[Alpha &amp; Co]]\n";
    const vault = [...allFiles, "Projects/Alpha & Co.md"];
    expect(convertWikilinksToMarkdownLinks(note, { sourcePath: "Projects/MOC.md", allFilePaths: vault })).toEqual({ content: note, result: { converted: 0, embeds: 1, unresolved: 1 } });
  });

  it("converts the link behind an address or a reference, never a place that only looks like it", () => {
    const options = { sourcePath: "Projects/MOC.md", allFilePaths: allFiles };
    // Cut out of its text, the address takes `[[Alpha` along; the link is the one behind it.
    expect(convertWikilinksToMarkdownLinks("[www.example.com/[[Alpha]] [[Alpha]]]\n", options)).toEqual({
      content: "[www.example.com/[[Alpha]] [Alpha](Alpha.md)]\n",
      result: { converted: 1, embeds: 0, unresolved: 0 },
    });
    // `&#33;` is read as `!`: an embed the source does not spell as one. It stays, and is counted as an embed.
    expect(convertWikilinksToMarkdownLinks("&#33;[[Alpha]] and [[Alpha]]\n", options)).toEqual({
      content: "&#33;[[Alpha]] and [Alpha](Alpha.md)\n",
      result: { converted: 1, embeds: 1, unresolved: 0 },
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

    expect(result).toEqual({ converted: 1, embeds: 0, unresolved: 2 });
    expect(out).toContain("[[Brief]]");
    expect(out).not.toContain("Archiv/Brief.md");
    expect(out).toContain("[Alpha](Alpha.md)");
    expect(out).toContain("[[Aufgaben.base]]");
  });
});
