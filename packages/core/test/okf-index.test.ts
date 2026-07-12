import { describe, it, expect } from "vitest";
import {
  generateIndexContent,
  findIndexCandidates,
  relativeMarkdownUrl,
  convertWikilinksToMarkdownLinks,
} from "../src/okf-index.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";

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
    expect(root.startsWith('---\nokf_version: "0.1"\n---\n')).toBe(true);

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
    const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
    const result = convertWikilinksToMarkdownLinks(ast, {
      sourcePath: "Projects/MOC.md",
      allFilePaths: allFiles,
    });

    expect(result.converted).toBe(3);
    const out = serializeMarkdownAst(ast);
    expect(out).toContain("[Alpha](Alpha.md)");
    expect(out).toContain("[Beta](Beta%20Note.md)");
    expect(out).toContain("[Gamma#Intro](../Other/Gamma.md#Intro)");
  });

  it("leaves embeds and unresolved targets untouched", () => {
    const md = "Embed ![[Alpha]] and missing [[Nowhere]].";
    const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
    const result = convertWikilinksToMarkdownLinks(ast, {
      sourcePath: "Projects/MOC.md",
      allFilePaths: allFiles,
    });

    expect(result).toEqual({ converted: 0, embeds: 1, unresolved: 1 });
    const out = serializeMarkdownAst(ast);
    expect(out).toContain("![[Alpha]]");
    expect(out).toContain("[[Nowhere]]");
  });
});
