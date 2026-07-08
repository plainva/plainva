import { describe, it, expect } from "vitest";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { updateFrontmatter } from "../src/metadata-updater.js";
import { serializeMarkdownAst } from "../src/markdown-serializer.js";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import type { ReadableFrontmatter } from "../src/metadata.js";

describe("Metadata Updater", () => {
  it("should update existing frontmatter", () => {
    const md = `---
title: Old Title
---
Some text.`;
    const ast = parseMarkdownAst(md);
    
    updateFrontmatter(ast, { title: "New Title", type: "Note" });
    
    const result = serializeMarkdownAst(ast);
    expect(result).toContain("title: New Title");
    expect(result).toContain("type: Note");
    expect(result).not.toContain("Old Title");
  });

  it("should add frontmatter to a file without it", () => {
    const md = `Just some text.`;
    const ast = parseMarkdownAst(md);

    updateFrontmatter(ast, { type: "Meeting Note", title: "Meeting" });

    const result = serializeMarkdownAst(ast);
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("type: Meeting Note");
    expect(result).toContain("title: Meeting");
    expect(result).toContain("Just some text.");
  });
});

// Roundtrip guarantees (plan C4): what updateFrontmatter writes must come back
// unchanged through serialize -> parse -> extract, without touching the body.
describe("Metadata Updater roundtrip", () => {
  const roundtrip = (md: string, data: ReadableFrontmatter) => {
    const ast = parseMarkdownAst(md);
    updateFrontmatter(ast, data);
    const out = serializeMarkdownAst(ast);
    const result = extractFrontmatter(parseMarkdownAst(out));
    if (!result.success) throw result.error;
    return { out, extracted: result.data };
  };

  it("preserves typed values (string, number, boolean, list) through a full roundtrip", () => {
    const data = { title: "Projekt Übersicht", priority: 3, done: false, tags: ["wissen", "ki"] };
    const { extracted } = roundtrip(`---\ntitle: Alt\n---\n\n# Kopf\n`, data);
    expect(extracted).toEqual(data);
  });

  it("quotes and restores values with YAML-special characters", () => {
    const data = { title: "Titel: mit Doppelpunkt", note: "#kein-tag", quote: 'sagt "hallo"' };
    const { extracted } = roundtrip(`---\ntitle: x\n---\nBody\n`, data);
    expect(extracted).toEqual(data);
  });

  it("leaves the markdown body untouched when updating frontmatter", () => {
    const body = `# Kopf\n\n- eins\n- zwei\n`;
    const { out } = roundtrip(`---\ntitle: Alt\n---\n\n${body}`, { title: "Neu" });
    expect(out.endsWith(body)).toBe(true);
  });

  it("is stable when the same data is applied twice", () => {
    const data = { title: "Neu", tags: ["a"] };
    const md = `---\ntitle: Alt\n---\n\nText.\n`;
    const first = roundtrip(md, data).out;
    const second = roundtrip(first, data).out;
    expect(second).toBe(first);
  });

  it("roundtrips frontmatter that was newly added to a plain note", () => {
    const data = { type: "Note", count: 1 };
    const { out, extracted } = roundtrip(`Nur Text.\n`, data);
    expect(extracted).toEqual(data);
    expect(out).toContain("Nur Text.");
  });
});
