import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";
import { toggleTaskStatusByText, renameVaultLink } from "../src/ast-mutations.js";

describe("AST Mutations", () => {
  describe("toggleTaskStatusByText", () => {
    it("should toggle a task status to true", () => {
      const md = "- [ ] Buy milk\n- [x] Read book";
      const ast = parseMarkdownAst(md);
      
      const found = toggleTaskStatusByText(ast, "Buy milk");
      expect(found).toBe(true);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("- [x] Buy milk");
      expect(result).toContain("- [x] Read book");
    });

    it("should toggle a task status to false", () => {
      const md = "- [x] Read book";
      const ast = parseMarkdownAst(md);
      
      const found = toggleTaskStatusByText(ast, "Read book");
      expect(found).toBe(true);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("- [ ] Read book");
    });

    it("should set a specific task status", () => {
      const md = "- [ ] Write code";
      const ast = parseMarkdownAst(md);
      
      const found = toggleTaskStatusByText(ast, "Write code", false);
      expect(found).toBe(true);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("- [ ] Write code"); // Remains false
    });
  });

  describe("renameVaultLink", () => {
    it("should rename a simple wikilink", () => {
      const md = "See [[Old File]] for more info.";
      const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
      
      const count = renameVaultLink(ast, "Old File", "New/Path/File");
      expect(count).toBe(1);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("[[New/Path/File]]");
    });

    it("should rename an aliased wikilink and preserve the alias", () => {
      const md = "See [[Old File|My Alias]] for more info.";
      const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
      
      const count = renameVaultLink(ast, "Old File", "New File");
      expect(count).toBe(1);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("[[New File|My Alias]]");
    });

    it("should rename an embed", () => {
      const md = "Here is a picture: ![[image.png]]";
      const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });
      
      const count = renameVaultLink(ast, "image.png", "assets/image.png");
      expect(count).toBe(1);
      
      const result = serializeMarkdownAst(ast);
      expect(result).toContain("![[assets/image.png]]");
    });

    it("should rename a standard markdown link", () => {
      const md = "See [My Alias](Old%20File.md) for more info.";
      const ast = parseMarkdownAst(md);

      const count = renameVaultLink(ast, "Old File.md", "New File.md");
      expect(count).toBe(1);

      const result = serializeMarkdownAst(ast);
      expect(result).toContain("[My Alias](New%20File.md)");
    });

    it("preserves heading anchors on wikilinks (with and without alias)", () => {
      const md = "See [[Old File#Intro]] and [[Old File#Intro|Alias]].";
      const ast = parseMarkdownAst(md, { preserveObsidianSyntax: true });

      const count = renameVaultLink(ast, "Old File", "New File");
      expect(count).toBe(2);

      const result = serializeMarkdownAst(ast);
      expect(result).toContain("[[New File#Intro]]");
      expect(result).toContain("[[New File#Intro|Alias]]");
    });

    it("preserves anchors on markdown links", () => {
      const md = "See [section](Old%20File.md#intro).";
      const ast = parseMarkdownAst(md);

      const count = renameVaultLink(ast, "Old File.md", "New File.md");
      expect(count).toBe(1);

      const result = serializeMarkdownAst(ast);
      expect(result).toContain("(New%20File.md#intro)");
    });
  });
});
