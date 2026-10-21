import { describe, expect, it } from "vitest";
import {
  applyTemplatePlaceholders,
  templateInsertText,
  templateInsertParts,
  extractTemplatePrompts,
  finalizeTemplate,
  interpolateTemplateBody,
  templateAsNewNote,
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

  // These two cases stood here against `applyTemplatePlaceholders`, which took
  // the template-only keys out itself — and so only for a note nobody was
  // asked about (finding 2026-10-11). The builder of the note takes them out
  // now, for every way a note is made (`templateAsNewNote`, newNote.test.ts);
  // the same two templates go through it, as they do on the paths without
  // questions.
  const noteWithoutQuestions = (raw: string) => templateAsNewNote({ text: applyTemplatePlaceholders(raw, "Meeting", now), cursor: null }, "Note").content;

  it("a note made from a template without questions loses the template's plainva.tasks opt-out (it shows its tasks)", () => {
    const raw = "---\ntype: Note\nplainva:\n  tasks: false\n---\n# {{title}}\n- [ ] do it";
    const out = noteWithoutQuestions(raw);
    expect(out).not.toContain("tasks: false");
    expect(out).not.toContain("plainva");
    expect(out).toContain("type: Note");
    expect(out).toContain("# Meeting");
    expect(out).toContain("- [ ] do it");
    // The placeholders alone fill the template and leave its properties as they stand.
    expect(applyTemplatePlaceholders(raw, "Meeting", now)).toBe("---\ntype: Note\nplainva:\n  tasks: false\n---\n# Meeting\n- [ ] do it");
  });

  it("a note made from a template without questions loses a legacy per-note okf_version (OKF v0.2: root index.md only)", () => {
    const raw = '---\ntype: Note\nokf_version: "0.1"\n---\n# {{title}}\n';
    const out = noteWithoutQuestions(raw);
    expect(out).not.toContain("okf_version");
    expect(out).toContain("type: Note");
    expect(out).toContain("# Meeting");
  });

  // Finding 2026-10-11. The body was read as the file has it. A byte order
  // mark is in front of a properties block and goes with it — but without a
  // block it was the first character of the body, and "insert template" in the
  // mail composer of both shells put it into the message.
  it("leaves a byte order mark the template opens with out of the text, with and without a properties block", () => {
    // Built at run time: the mark is never typed into this file.
    const mark = String.fromCharCode(0xfeff);
    expect(templateInsertText(`${mark}Hallo {{title}}\n`, "X", now)).toBe("Hallo X\n");
    expect(templateInsertText(`${mark}---\na: b\n---\nHallo {{title}}\n`, "X", now)).toBe("Hallo X\n");
    // The caret is a place in the text that is handed on, so it does not count the mark.
    expect(templateInsertParts(`${mark}{{cursor}}Hallo {{title}}\n`, "X", {}, now)).toEqual({ text: "Hallo X\n", cursor: 0 });
    expect(interpolateTemplateBody(`${mark}{{title}} {{cursor}}{{prompt:Z}}`, "T", now)).toBe("T {{cursor}}{{prompt:Z}}");
  });

  it("hands the text on as an editor holds it: one line end for each line of a template written on Windows", () => {
    expect(templateInsertText("Hallo {{title}}\r\nZeile 2\r\n", "X", now)).toBe("Hallo X\nZeile 2\n");
    const mark = String.fromCharCode(0xfeff);
    expect(templateInsertParts(`${mark}---\r\na: b\r\n---\r\nHallo {{title}}\r\n{{cursor}}Ende\r\n`, "X", {}, now)).toEqual({ text: "Hallo X\nEnde\n", cursor: 8 });
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

  it("interpolateTemplateBody strips a block without entries, and nothing of the text up to the next rule", () => {
    expect(interpolateTemplateBody("---\n---\n{{title}}\n", "T", now)).toBe("T\n");
    expect(interpolateTemplateBody("---\n---\n{{title}}\n\n---\n\nRest\n", "T", now)).toBe("T\n\n---\n\nRest\n");
  });
});
