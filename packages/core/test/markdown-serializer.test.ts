import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst, serializeMarkdownLink } from "../src/markdown-serializer.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Markdown Serializer", () => {
  it("should correctly serialize roundtrip frontmatter document", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/frontmatter.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });
    const result = serializeMarkdownAst(ast);
    
    expect(result).toContain("title: Roundtrip Fixture");
    expect(result).toContain("# Note With Frontmatter");
    expect(result).toContain("- Stable item");
  });

  it("should preserve obsidian wikilinks during serialization", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/obsidian-wikilink.input.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });
    const result = serializeMarkdownAst(ast);
    
    expect(result).toContain("[[Wikilink]]");
    expect(result).toContain("[[Folder/File|with an alias]]");
  });
  
  it("should preserve obsidian embeds during serialization", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/obsidian-embed.input.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });
    const result = serializeMarkdownAst(ast);
    
    expect(result).toContain("![[image.png]]");
  });
});

/**
 * The serializer writes NEW text. Its one use in the app is a link that takes
 * the place of a wiki link when an overview is prepared; a note that is
 * already there is never written back from its tree (finding 2026-10-09).
 */
describe("serializeMarkdownLink", () => {
  it("writes one link, without a line end of its own", () => {
    expect(serializeMarkdownLink("Alpha", "Alpha.md")).toBe("[Alpha](Alpha.md)");
    expect(serializeMarkdownLink("Gamma#Intro", "../Other/Gamma.md#Intro")).toBe("[Gamma#Intro](../Other/Gamma.md#Intro)");
    expect(serializeMarkdownLink("", "Alpha.md")).toBe("[](Alpha.md)");
  });

  it("writes a label so that it reads as the text it is", () => {
    for (const label of ["a*b_c", "[x] y", "tick `x`", "~~del~~", "<b>", "a & b &amp; c", "1. item", "# h", "back\\slash"]) {
      const link = serializeMarkdownLink(label, "x.md");
      // Read back by the parser, the link's text is the label and its destination the one that was given.
      const paragraph = (parseMarkdownAst(link).children[0] as unknown as { children: Array<{ type: string; url?: string; children?: Array<{ type: string; value?: string }> }> }).children;
      expect(paragraph.map((node) => node.type), link).toEqual(["link"]);
      expect(paragraph[0].url, link).toBe("x.md");
      expect(paragraph[0].children!.map((node) => node.value).join(""), link).toBe(label);
    }
    expect(serializeMarkdownLink("a*b_c", "x.md")).toBe("[a\\*b\\_c](x.md)");
  });

  it("keeps a `|` inside a table cell", () => {
    expect(serializeMarkdownLink("one | two", "x.md")).toBe("[one | two](x.md)");
    expect(serializeMarkdownLink("one | two", "x.md", { inTable: true })).toBe("[one \\| two](x.md)");
    // A character the label already escapes is not escaped twice.
    expect(serializeMarkdownLink("a*b | c", "x.md", { inTable: true })).toBe("[a\\*b \\| c](x.md)");
    const row = `| ${serializeMarkdownLink("one | two", "x.md", { inTable: true })} | second |`;
    const table = parseMarkdownAst(`| a | b |\n|---|---|\n${row}\n`).children[0] as unknown as { children: Array<{ children: unknown[] }> };
    expect(table.children[1].children).toHaveLength(2);
  });
});
