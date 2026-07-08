import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { extractFrontmatterLinks, extractLinksAndTags } from "../src/ast-scanner.js";

describe("AST Scanner", () => {
  it("should extract inline tags and frontmatter tags", () => {
    const md = `---
tags:
  - from_fm
---
Here is a #inline-tag and #nested/tag.
Not a #123 tag.
`;
    const ast = parseMarkdownAst(md);
    const result = extractLinksAndTags(ast);

    expect(result.tags).toEqual([
      { name: "from_fm", source: "frontmatter" },
      { name: "inline-tag", source: "inline" },
      { name: "nested/tag", source: "inline" }
    ]);
  });

  it("should extract wikilinks and embeds", () => {
    const md = `
[[WikiLink]]
[[Folder/Note|Alias Name]]
![[Image.png|100x100]]
`;
    // We must pass preserveObsidianSyntax to parse these correctly as HTML nodes
    const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
    const result = extractLinksAndTags(ast);

    expect(result.links).toEqual([
      { type: "wikilink", target: "WikiLink", rawTarget: "WikiLink", alias: undefined },
      { type: "wikilink", target: "Folder/Note", rawTarget: "Folder/Note", alias: "Alias Name" },
      { type: "embed", target: "Image.png", rawTarget: "Image.png", alias: "100x100" }
    ]);
  });

  it("should extract standard markdown links", () => {
    const md = `
[Plainva](https://plainva.com)
`;
    const ast = parseMarkdownAst(md);
    const result = extractLinksAndTags(ast);

    expect(result.links).toEqual([
      { type: "markdown-link", target: "https://plainva.com", rawTarget: "https://plainva.com", alias: "Plainva" }
    ]);
  });
});

describe("extractFrontmatterLinks", () => {
  it("extracts whole-value wiki links from scalars and list items", () => {
    const links = extractFrontmatterLinks({
      projekt: "[[Projekt X]]",
      refs: ["[[A]]", "[[B]]"],
    });
    expect(links).toEqual([
      { propertyKey: "projekt", target: "Projekt X", rawTarget: "Projekt X", anchor: undefined, alias: undefined },
      { propertyKey: "refs", target: "A", rawTarget: "A", anchor: undefined, alias: undefined },
      { propertyKey: "refs", target: "B", rawTarget: "B", anchor: undefined, alias: undefined },
    ]);
  });

  it("splits alias and anchor with body-link semantics", () => {
    const links = extractFrontmatterLinks({ rel: "[[Note#heading|Shown]]" });
    expect(links).toEqual([
      { propertyKey: "rel", target: "Note", rawTarget: "Note#heading", anchor: "#heading", alias: "Shown" },
    ]);
  });

  it("ignores links embedded in longer text and embeds", () => {
    expect(extractFrontmatterLinks({ note: "see [[Inline]] here" })).toEqual([]);
    expect(extractFrontmatterLinks({ img: "![[Image.png]]" })).toEqual([]);
  });

  it("ignores non-string values, nested arrays and anchor-only links", () => {
    expect(
      extractFrontmatterLinks({
        num: 5,
        flag: true,
        none: null,
        obj: { a: "[[X]]" },
        nested: [["[[A]]"]],
        anchorOnly: "[[#heading]]",
      })
    ).toEqual([]);
  });

  it("skips the plainva namespace key", () => {
    expect(extractFrontmatterLinks({ plainva: "[[X]]" as any })).toEqual([]);
  });
});
