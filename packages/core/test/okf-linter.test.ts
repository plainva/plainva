import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { lintMarkdownAst } from "../src/okf-linter.js";

describe("OKF Linter", () => {
  it("should return no warnings for a fully compliant note", () => {
    const md = `---
type: Meeting Note
title: Project Kickoff
---
# Project Kickoff
Some text here.
`;
    const ast = parseMarkdownAst(md);
    const messages = lintMarkdownAst(ast);
    expect(messages).toHaveLength(0);
  });

  it("should return no warnings if title is only in H1", () => {
    const md = `---
type: Meeting Note
---
# Project Kickoff
Some text here.
`;
    const ast = parseMarkdownAst(md);
    const messages = lintMarkdownAst(ast);
    expect(messages).toHaveLength(0);
  });

  it("should return missing-frontmatter and missing-title warnings for empty note", () => {
    const md = `Just some text without anything else.`;
    const ast = parseMarkdownAst(md);
    const messages = lintMarkdownAst(ast);
    
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "okf-missing-frontmatter" })
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "okf-missing-title" })
    );
  });

  it("should warn about missing type field", () => {
    const md = `---
title: My note
---
Some text here.
`;
    const ast = parseMarkdownAst(md);
    const messages = lintMarkdownAst(ast);
    
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "okf-missing-type" })
    );
  });

  it("should report an error for invalid frontmatter YAML", () => {
    const md = `---
title: My note
type: [unclosed array
---
# Valid H1
Some text here.
`;
    const ast = parseMarkdownAst(md);
    const messages = lintMarkdownAst(ast);
    
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "okf-invalid-frontmatter", severity: "error" })
    );
  });

  it("names a value outside the form the spec gives its field, which the reader reads all the same", () => {
    // Until 2026-10-22 the reader's schema refused such a block and the linter said so through it;
    // the reader takes every value now (ADR 0009), and the linter checks the forms itself.
    for (const line of ["resource: not a url", "timestamp: 2026-06-22", "tags:", "title: 2024", "aliases:\n  - 2024"]) {
      const messages = lintMarkdownAst(parseMarkdownAst(`---\ntype: Reference\n${line}\n---\n# Heading\n`));
      expect(messages, line).toEqual([expect.objectContaining({ ruleId: "okf-invalid-frontmatter", severity: "error" })]);
    }
    const valid = "---\ntype: Reference\nresource: https://example.com\ntimestamp: 2026-06-22T10:00:00+02:00\ntags: a, b\n---\n# Heading\n";
    expect(lintMarkdownAst(parseMarkdownAst(valid))).toEqual([]);
  });
});
