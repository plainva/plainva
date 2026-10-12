import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";
import { toggleTaskStatusByText } from "../src/ast-mutations.js";

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

  // `renameVaultLink` stood here: it renamed a link in the tree, and the note
  // had to be written back from the tree. Its six cases are held, with the
  // same notes and the same answers, in link-rewrite.test.ts — against
  // `renameNoteLinks`, which changes the link where it stands in the text.
});
