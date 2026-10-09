import { describe, it, expect, beforeEach, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { frontmatterSpan, upsertFrontmatterKeys } from "@plainva/core";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import {
  buildNewNoteContent,
  withOkfDefaults,
  getConfiguredNoteType,
  getConfiguredDailyNoteType,
} from "./newNote";
import { templateAsNewNote, templateCaretInNote } from "@plainva/ui";
import { defaultNoteTypeKey, dailyNoteTypeKey } from "../contexts/VaultContext";

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
});

describe("buildNewNoteContent", () => {
  it("produces the OKF minimum frontmatter (type only — no per-note okf_version)", () => {
    const content = buildNewNoteContent("Note");
    const fm = frontmatterOf(content);
    expect(fm.type).toBe("Note");
    expect(fm.okf_version).toBeUndefined();
  });

  it("adds an H1 with the note title after the frontmatter", () => {
    const content = buildNewNoteContent("Note", "Projekt Alpha");
    expect(frontmatterOf(content).type).toBe("Note");
    expect(content).toContain("# Projekt Alpha");
    expect(content.indexOf("# Projekt Alpha")).toBeGreaterThan(content.indexOf("---"));
  });

  it("trims the title and stays blank without one (template scaffolds)", () => {
    expect(buildNewNoteContent("Note", "  X  ")).toContain("# X");
    expect(buildNewNoteContent("Note")).not.toContain("# ");
    expect(buildNewNoteContent("Note", "   ")).not.toContain("# ");
  });
});

describe("withOkfDefaults", () => {
  it("keeps a template's own type and adds no okf_version", () => {
    const template = "---\ntype: Meeting Note\ntitle: X\n---\n\n## Agenda\n";
    const result = withOkfDefaults(template, "Note");
    const fm = frontmatterOf(result);
    expect(fm.type).toBe("Meeting Note");
    expect(fm.okf_version).toBeUndefined();
    expect(result).toContain("## Agenda");
  });

  it("prepends frontmatter to a template without one", () => {
    const result = withOkfDefaults("## Tagesplan\n", "Daily Note");
    expect(frontmatterOf(result).type).toBe("Daily Note");
    expect(result.endsWith("## Tagesplan\n")).toBe(true);
  });

  it("returns content unchanged when the template frontmatter is broken", () => {
    const broken = "---\ntitle: [unclosed\n---\nBody\n";
    expect(withOkfDefaults(broken, "Note")).toBe(broken);
  });

  it("puts nothing between the header and the text, and hands the text on byte for byte", () => {
    // The one writer of a new note's header for both shells (finding
    // 2026-10-09): the phone had strings of its own that set a blank line here.
    expect(buildNewNoteContent("Note", "Projekt Alpha")).toBe("---\ntype: Note\n---\n# Projekt Alpha\n");
    expect(withOkfDefaults("\n\n# Titel\n", "Note")).toBe("---\ntype: Note\n---\n\n\n# Titel\n");
    expect(withOkfDefaults("# Titel\r\nText\r\n", "Note")).toBe("---\r\ntype: Note\r\n---\r\n# Titel\r\nText\r\n");
  });

  it("writes `type` into the block that is there — also the empty one — and takes a rule on top for text", () => {
    expect(withOkfDefaults("---\nstatus: entwurf\n---\n# Titel\n", "Note")).toBe("---\nstatus: entwurf\ntype: Note\n---\n# Titel\n");
    expect(withOkfDefaults("---\n---\n# Titel\n", "Note")).toBe("---\ntype: Note\n---\n# Titel\n");
    expect(withOkfDefaults("---\n\nText unter einer Linie\n", "Note")).toBe("---\ntype: Note\n---\n---\n\nText unter einer Linie\n");
  });
});

/**
 * A resolved template as a new note, and where its `{{cursor}}` stands in what
 * is written — the builder of both shells (finding 2026-10-09). The phone's
 * own tests drive it through the phone's path (`apps/mobile/src/templateRules.test.ts`).
 */
describe("templateAsNewNote", () => {
  /** A template as the engine hands it over: `|` marks where `{{cursor}}` stood. */
  function resolved(marked: string): { text: string; cursor: number | null } {
    const at = marked.indexOf("|");
    return at < 0 ? { text: marked, cursor: null } : { text: marked.slice(0, at) + marked.slice(at + 1), cursor: at };
  }

  /** What stands behind the caret; "" is the end of the note. */
  function behindCaret(note: { content: string; caret: number | null }): string {
    if (note.caret === null) throw new Error("the template's caret was lost");
    return note.content.slice(note.caret);
  }

  it("finds the caret behind a header put in front of the template", () => {
    const note = templateAsNewNote(resolved("# Titel\n\n- [ ] |\n"), "Note");
    expect(note.content).toBe("---\ntype: Note\n---\n# Titel\n\n- [ ] \n");
    expect(behindCaret(note)).toBe("\n");
  });

  it("finds it behind a block that `type` was written into, whatever that did to the block's length", () => {
    const grown = templateAsNewNote(resolved("---\nstatus: entwurf\n---\n# Titel\n\n|Text\n"), "Note");
    expect(grown.content).toBe("---\nstatus: entwurf\ntype: Note\n---\n# Titel\n\nText\n");
    expect(behindCaret(grown)).toBe("Text\n");
    // The writer sets the block's lines anew: fences lose their blanks, a list
    // gets its indent. The text behind the block is not touched.
    const rewritten = templateAsNewNote(resolved("--- \ntags:\n- a\n---  \n|Text\n"), "Note");
    expect(rewritten.content).toBe("---\ntags:\n  - a\ntype: Note\n---\nText\n");
    expect(behindCaret(rewritten)).toBe("Text\n");
    const empty = templateAsNewNote(resolved("---\n---\n# Titel\n|"), "Note");
    expect(empty.content).toBe("---\ntype: Note\n---\n# Titel\n");
    expect(behindCaret(empty)).toBe("");
  });

  it("leaves a template with a `type` of its own, or with a block it cannot read, as it is — caret included", () => {
    const own = resolved("---\ntype: Meeting\n---\n\n# Titel\n|Text\n");
    expect(templateAsNewNote(own, "Note")).toEqual({ content: own.text, caret: own.cursor });
    const broken = resolved("---\ntitle: [unclosed\n---\n|Body\n");
    expect(templateAsNewNote(broken, "Note")).toEqual({ content: broken.text, caret: broken.cursor });
  });

  it("keeps Windows line ends and a byte order mark, and still finds the caret", () => {
    const crlf = templateAsNewNote(resolved("---\r\nstatus: entwurf\r\n---\r\n# Titel\r\n|Text\r\n"), "Note");
    expect(crlf.content).toBe("---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Titel\r\nText\r\n");
    expect(behindCaret(crlf)).toBe("Text\r\n");
    // The mark stays the file's first character, so the header goes BEHIND it:
    // the template's text is then no longer the end of the note mark and all.
    const mark = String.fromCharCode(0xfeff);
    const marked = templateAsNewNote(resolved(`${mark}# Titel\n|Text\n`), "Note");
    expect(marked.content).toBe(`${mark}---\ntype: Note\n---\n# Titel\nText\n`);
    expect(behindCaret(marked)).toBe("Text\n");
  });

  it("puts a caret that stood in the template's properties block at the start of the text", () => {
    // The live editor hides the block and takes no caret in it. Counted on by
    // what the note grew, this caret came to stand at the end of the `type` line.
    const note = templateAsNewNote(resolved("---\nstatus: |\n---\n# Titel\n"), "Note");
    expect(note.content).toBe("---\nstatus:\ntype: Note\n---\n# Titel\n");
    expect(behindCaret(note)).toBe("# Titel\n");
    // A template that is only properties: the caret goes to the end.
    const only = templateAsNewNote(resolved("---\nstatus: entwurf\n---\n|"), "Note");
    expect(only.content).toBe("---\nstatus: entwurf\ntype: Note\n---\n\n");
    expect(only.caret).toBe(only.content.length);
  });

  it("has no caret for a template without a cursor marker", () => {
    expect(templateAsNewNote(resolved("# Titel\n"), "Note").caret).toBeNull();
  });
});

describe("templateCaretInNote", () => {
  it("keeps a caret in the text at its place when the block in front of it grows, shrinks or goes", () => {
    const template = "---\na: 1\nb: 2\n---\nEins\nZwei\n";
    const caret = template.indexOf("Zwei");
    for (const note of ["---\na: 1\nb: 2\nc: 3\n---\nEins\nZwei\n", "---\na: 1\n---\nEins\nZwei\n", "Eins\nZwei\n"]) {
      expect(note.slice(templateCaretInNote(template, note, caret)), note).toBe("Zwei\n");
    }
  });

  it("never answers with a place in the properties block, even where nothing was rewritten", () => {
    const note = "---\ntype: Meeting\nstatus: \n---\n# Titel\n";
    expect(templateCaretInNote(note, note, note.indexOf("status: ") + 8)).toBe(note.indexOf("# Titel"));
    expect(templateCaretInNote(note, note, 0)).toBe(note.indexOf("# Titel"));
  });

  it("stays inside the note when the text is not the template's any more", () => {
    // No builder changes the text today; should one ever, the caret keeps its
    // distance from where the note's text starts, and never points past the end.
    expect(templateCaretInNote("Eins\nZwei\n", "---\ntype: Note\n---\nEins\n", 5)).toBe("---\ntype: Note\n---\nEins\n".length);
    expect(templateCaretInNote("Eins\nZwei\n", "---\ntype: Note\n---\nEINS\nZwei", 5)).toBe("---\ntype: Note\n---\nEINS\n".length);
  });

  it("is the old sum for every caret in the text, and the start of the text for every caret in front of it", () => {
    // Each builder used to count the caret on by what the note had grown. Over
    // generated templates that is the same place for a caret in the text —
    // which is why no such caret moved when the rule became one — and the two
    // part only for a caret in the properties block.
    let seed = 20261009;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const entries = ["status: entwurf", "tags: [a, b]", "tags:\n- a\n- b", "type: Meeting", "type:", "# comment", 'note: "a: b"', "plainva:\n  icon: x", "broken: [unclosed", "just text"];
    const lines = ["# Titel", "", "Text", "---", "- [ ] ", "a: b", "--- ", "Zeile mit --- Strichen", "  eingerückt"];
    const mark = String.fromCharCode(0xfeff);
    const textStart = (note: string) => frontmatterSpan(note)?.end ?? (note.startsWith(mark) ? 1 : 0);
    let inText = 0;
    let inFront = 0;
    let rewritten = 0;
    for (let i = 0; i < 5000; i++) {
      const eol = random() < 0.2 ? "\r\n" : "\n";
      const parts: string[] = [];
      if (random() < 0.55) {
        const block = Array.from({ length: Math.floor(random() * 4) }, () => pick(entries));
        parts.push(random() < 0.1 ? "--- " : "---", ...block.join("\n").split("\n"), random() < 0.1 ? "---  " : "---");
      }
      for (let n = Math.floor(random() * 5); n > 0; n--) parts.push(pick(lines));
      let template = parts.join(eol);
      if (template && random() < 0.8) template += eol;
      if (random() < 0.05) template = mark + template;
      const caret = Math.floor(random() * (template.length + 1));
      // What a database item goes through: the OKF defaults, then tags and prefills.
      let note = withOkfDefaults(template, "Note");
      if (random() < 0.5) {
        try {
          note = upsertFrontmatterKeys(note, { tags: ["x"], status: "offen" });
        } catch {
          // a block that cannot be read stays as it is
        }
      }
      if (note !== template) rewritten++;
      const found = templateCaretInNote(template, note, caret);
      const text = template.slice(textStart(template));
      const at = JSON.stringify({ template, note, caret });
      if (caret >= textStart(template)) {
        inText++;
        expect(found, at).toBe(caret + (note.length - template.length));
        if (text) expect(note.slice(found), at).toBe(template.slice(caret));
      } else {
        inFront++;
        expect(found, at).toBeGreaterThanOrEqual(textStart(note));
        if (text) expect(note.slice(found), at).toBe(text);
      }
    }
    expect(rewritten).toBeGreaterThan(3000);
    expect(inText).toBeGreaterThan(2000);
    expect(inFront).toBeGreaterThan(1000);
  });
});

describe("configured types", () => {
  it("falls back to defaults when nothing is configured", async () => {
    expect(await getConfiguredNoteType("/vault")).toBe("Note");
    expect(await getConfiguredDailyNoteType("/vault")).toBe("Daily Note");
  });

  it("uses the per-vault configured values, trimmed", async () => {
    storeValues[defaultNoteTypeKey("/vault")] = "  Zettel  ";
    storeValues[dailyNoteTypeKey("/vault")] = "Journal";
    expect(await getConfiguredNoteType("/vault")).toBe("Zettel");
    expect(await getConfiguredDailyNoteType("/vault")).toBe("Journal");
  });

  it("treats a blank configured value as unset", async () => {
    storeValues[defaultNoteTypeKey("/vault")] = "   ";
    expect(await getConfiguredNoteType("/vault")).toBe("Note");
  });
});
