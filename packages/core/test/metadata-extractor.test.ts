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

  it("reads a block whose lines end in a carriage return of its own", () => {
    // The Markdown parser ends a line there and hands the block out with the
    // carriage returns in it; the YAML library takes one for part of a line.
    // Two entries were a syntax error, a list was one string, and a comment
    // swallowed the line behind it.
    const read = (note: string) => extractFrontmatter(parseMarkdownAst(note));
    expect(read("---\rtitle: Old Mac\rtags:\r  - a\r  - b\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac", tags: ["a", "b"] } });
    expect(read("---\r# a comment\rtitle: Old Mac\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac" } });
    expect(read("---\rtitle: Old Mac\r\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac" } });
    // A stray one in a block with other line ends is a line break as well.
    expect(read("---\ntitle: Stray\rtags: [a]\n---\n# Body\n")).toEqual({ success: true, data: { title: "Stray", tags: ["a"] } });
    expect(read("---\r\ntitle: Windows\r\ntags: [a]\r\n---\r\n# Body\r\n")).toEqual({ success: true, data: { title: "Windows", tags: ["a"] } });
    // `\r\r\n` on every line — line ends from Windows, converted twice. Each
    // value came back with a carriage return at its end, a number as a string.
    expect(read("---\r\r\ntitle: Twice\r\r\ncount: 3\r\r\n---\r\r\n# Body\r\r\n")).toEqual({ success: true, data: { title: "Twice", count: 3 } });
  });
});
