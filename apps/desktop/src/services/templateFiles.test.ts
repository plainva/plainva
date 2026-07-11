import { describe, expect, it } from "vitest";
import { applyTemplatePlaceholders, templateInsertText } from "@plainva/ui";

describe("templateInsertText (shared insert-into-note contract)", () => {
  const now = new Date(2026, 6, 11, 9, 30);

  it("strips the template's leading frontmatter and interpolates placeholders", () => {
    const raw = '---\ntype: Note\nokf_version: "1.0"\n---\n\n# {{title}}\n\nCreated {{date}} {{time}}\n';
    expect(templateInsertText(raw, "Meeting", now)).toBe(
      "\n# Meeting\n\nCreated 2026-07-11 09:30\n",
    );
  });

  it("leaves templates without frontmatter untouched apart from placeholders", () => {
    expect(templateInsertText("Hello {{title}}", "World", now)).toBe("Hello World");
  });

  it("only strips a LEADING frontmatter block, never a mid-document one", () => {
    const raw = "Intro\n\n---\nnot: frontmatter\n---\n";
    expect(templateInsertText(raw, "X", now)).toBe(raw);
  });

  it("handles CRLF frontmatter fences", () => {
    expect(templateInsertText("---\r\na: b\r\n---\r\nBody", "X", now)).toBe("Body");
  });

  it("applyTemplatePlaceholders replaces every occurrence", () => {
    expect(applyTemplatePlaceholders("{{title}}/{{title}} {{date}}", "A", now)).toBe(
      "A/A 2026-07-11",
    );
  });
});
