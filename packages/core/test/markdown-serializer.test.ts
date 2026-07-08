import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";
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
