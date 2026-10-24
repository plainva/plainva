import { describe, expect, it } from "vitest";
import {
  applyTemplatePlaceholders,
  extractTemplatePrompts,
  finalizeTemplate,
  templateAsNewNote,
  templateBodyOf,
} from "@plainva/ui";

// The text a template contributes to a mail (the composers of both shells).
// Placeholders stay for the one pass of the pipeline with questions: the three
// functions these cases stood against filled the text first, without the
// shell's context and without asking (Sammelplan § 3.97).
describe("templateBodyOf (the text a template puts into a mail)", () => {
  const now = new Date(2026, 6, 11, 9, 30);

  it("strips the template's leading frontmatter and leaves every placeholder for the pipeline", () => {
    const raw = '---\ntype: Note\nokf_version: "1.0"\n---\n\n# {{title}}\n\nCreated {{date}} {{time}}\n{{prompt:Who|Kim}} {{cursor}}\n';
    expect(templateBodyOf(raw)).toBe("\n# {{title}}\n\nCreated {{date}} {{time}}\n{{prompt:Who|Kim}} {{cursor}}\n");
  });

  it("leaves a template without frontmatter as it is", () => {
    expect(templateBodyOf("Hello {{title}}")).toBe("Hello {{title}}");
  });

  it("only strips a LEADING frontmatter block, never a mid-document one", () => {
    const raw = "Intro\n\n---\nnot: frontmatter\n---\n";
    expect(templateBodyOf(raw)).toBe(raw);
  });

  it("handles CRLF frontmatter fences", () => {
    expect(templateBodyOf("---\r\na: b\r\n---\r\nBody")).toBe("Body");
  });

  it("strips a block without entries, and nothing of the text up to the next rule", () => {
    expect(templateBodyOf("---\n---\n{{title}}\n")).toBe("{{title}}\n");
    expect(templateBodyOf("---\n---\n{{title}}\n\n---\n\nRest\n")).toBe("{{title}}\n\n---\n\nRest\n");
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
    expect(templateBodyOf(`${mark}Hallo {{title}}\n`)).toBe("Hallo {{title}}\n");
    expect(templateBodyOf(`${mark}---\na: b\n---\nHallo {{title}}\n`)).toBe("Hallo {{title}}\n");
    // A `{{cursor}}` counts in the text that is handed on, not in the file.
    expect(templateBodyOf(`${mark}{{cursor}}Hallo\n`).indexOf("{{cursor}}")).toBe(0);
  });

  it("hands the text on as an editor holds it: one line end for each line of a template written on Windows", () => {
    expect(templateBodyOf("Hallo {{title}}\r\nZeile 2\r\n")).toBe("Hallo {{title}}\nZeile 2\n");
    const mark = String.fromCharCode(0xfeff);
    expect(templateBodyOf(`${mark}---\r\na: b\r\n---\r\nHallo {{title}}\r\n{{cursor}}Ende\r\n`)).toBe("Hallo {{title}}\n{{cursor}}Ende\n");
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

  it("applyTemplatePlaceholders (new-note path) never leaks a cursor/prompt token", () => {
    expect(applyTemplatePlaceholders("A{{cursor}}B {{prompt:P}}", "T", now)).toBe("AB ");
  });

});
