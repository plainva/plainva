import { describe, it, expect } from "vitest";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Frontmatter Extractor", () => {
  it("should extract valid frontmatter", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/frontmatter.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        title: "Roundtrip Fixture",
        tags: ["plainva", "roundtrip"]
      });
    }
  });

  it("should return null data for documents without frontmatter", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/plain-note.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("should gracefully fail with invalid yaml syntax", () => {
    const content = "---\ntitle: [invalid\n---\n# Note";
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.name).toBe("YAMLParseError");
    }
  });

  it("should return fallback data for empty frontmatter block", () => {
    const content = "---\n---\n# Empty Frontmatter Note";
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });
});
