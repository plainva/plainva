import { describe, expect, it } from "vitest";
import {
  applyTemplatePlaceholders,
  templateInsertText,
  templateInsertParts,
  extractTemplatePrompts,
  finalizeTemplate,
  interpolateTemplateBody,
} from "@plainva/ui";

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

  it("applyTemplatePlaceholders strips a template's plainva.tasks opt-out (a derived note shows its tasks)", () => {
    const raw = "---\ntype: Note\nplainva:\n  tasks: false\n---\n# {{title}}\n- [ ] do it";
    const out = applyTemplatePlaceholders(raw, "Meeting", now);
    expect(out).not.toContain("tasks: false");
    expect(out).not.toContain("plainva");
    expect(out).toContain("type: Note");
    expect(out).toContain("# Meeting");
    expect(out).toContain("- [ ] do it");
  });
});

describe("Templater-lite tokens ({{cursor}}, {{prompt}})", () => {
  const now = new Date(2026, 6, 11, 9, 30);

  it("extractTemplatePrompts lists unique labels in first-seen order", () => {
    expect(
      extractTemplatePrompts("{{prompt:Title}} x {{prompt:Assignee}} {{prompt:Title}}"),
    ).toEqual(["Title", "Assignee"]);
    expect(extractTemplatePrompts("no prompts {{cursor}} here")).toEqual([]);
  });

  it("finalizeTemplate fills prompts and extracts the first cursor offset", () => {
    const r = finalizeTemplate("Hi {{prompt:Name}}!{{cursor}} bye", { Name: "Sam" });
    expect(r.text).toBe("Hi Sam! bye");
    expect(r.cursor).toBe(7);
  });

  it("finalizeTemplate blanks an unanswered prompt and reports no cursor", () => {
    const r = finalizeTemplate("[{{prompt:X}}]");
    expect(r.text).toBe("[]");
    expect(r.cursor).toBeNull();
  });

  it("templateInsertParts strips frontmatter, interpolates and resolves cursor/prompts", () => {
    const raw = "---\na: b\n---\n# {{title}} {{date}}\n{{cursor}}Body {{prompt:Who}}";
    const r = templateInsertParts(raw, "Meeting", { Who: "Kim" }, now);
    expect(r.text).toBe("# Meeting 2026-07-11\nBody Kim");
    expect(r.cursor).toBe(21);
  });

  it("applyTemplatePlaceholders (new-note path) never leaks a cursor/prompt token", () => {
    expect(applyTemplatePlaceholders("A{{cursor}}B {{prompt:P}}", "T", now)).toBe("AB ");
  });

  it("templateInsertText resolves tokens without returning a caret", () => {
    expect(templateInsertText("x{{cursor}}y {{prompt:Q}}", "T", now)).toBe("xy ");
  });

  it("interpolateTemplateBody keeps cursor/prompt tokens for a later finalize", () => {
    const body = interpolateTemplateBody("---\nf: m\n---\n{{title}} {{cursor}}{{prompt:Z}}", "T", now);
    expect(body).toBe("T {{cursor}}{{prompt:Z}}");
  });
});
