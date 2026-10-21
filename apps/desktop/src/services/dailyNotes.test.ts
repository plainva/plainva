import { describe, it, expect, vi, beforeEach } from "vitest";
import { parse as parseYaml } from "yaml";
import { editorTextOf } from "@plainva/core";
import { buildDailyNotePath, clearPendingTemplateCaret, consumePendingTemplateCaret } from "@plainva/ui";
import { listExistingDailyNotes, makeDailyPathProvider, noteStamp, resolveOrCreateDailyNote } from "./dailyNotes";
import { applyTemplateInteractive } from "./templateInteractive";
import {
  dailyNotesFolderKey,
  dailyNotesFormatKey,
  dailyNoteTypeKey,
  templateFolderKey,
  dailyNoteTemplateKey,
} from "../contexts/VaultContext";

// listExistingDailyNotes reads the per-vault folder/format settings from the
// Tauri store — stub it (and the dialog plugin pulled in by dailyNotes.ts).
// The store mock also provides the bare `load` export, which the transitively
// imported CredentialManager calls at module scope (via VaultContext).
const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

describe("buildDailyNotePath", () => {
  const date = new Date(2024, 2, 5); // 2024-03-05, local time

  it("uses the default format with no folder", () => {
    const { fullPath, dateStr } = buildDailyNotePath(date, "YYYY-MM-DD", "");
    expect(dateStr).toBe("2024-03-05");
    expect(fullPath).toBe("2024-03-05.md");
  });

  it("joins the daily-notes folder", () => {
    expect(buildDailyNotePath(date, "YYYY-MM-DD", "Journal").fullPath).toBe("Journal/2024-03-05.md");
  });

  it("strips a trailing slash from the folder", () => {
    expect(buildDailyNotePath(date, "YYYY-MM-DD", "Journal/").fullPath).toBe("Journal/2024-03-05.md");
  });

  it("converts Moment-style tokens (YYYY/MM) to date-fns and applies them", () => {
    const { fullPath, dateStr } = buildDailyNotePath(date, "YYYY-MM", "");
    expect(dateStr).toBe("2024-03");
    expect(fullPath).toBe("2024-03.md");
  });

  it("does not double-append .md", () => {
    expect(buildDailyNotePath(date, "YYYY-MM-DD", "").fullPath.endsWith(".md.md")).toBe(false);
  });
});

describe("listExistingDailyNotes", () => {
  const VAULT = "/vault";
  const dates = [new Date(2024, 2, 5), new Date(2024, 2, 6), new Date(2024, 2, 7)];

  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  it("returns only the local-date keys whose note exists on disk", async () => {
    const exists = vi.fn(async (p: string) => p === "2024-03-05.md" || p === "2024-03-07.md");
    const result = await listExistingDailyNotes(dates, { vaultPath: VAULT, adapter: { exists } });
    expect(result).toEqual(new Set(["2024-03-05", "2024-03-07"]));
  });

  it("builds paths from the configured folder and format", async () => {
    storeValues[dailyNotesFolderKey(VAULT)] = "Journal";
    storeValues[dailyNotesFormatKey(VAULT)] = "DD.MM.YYYY";
    const checked: string[] = [];
    const exists = vi.fn(async (p: string) => { checked.push(p); return true; });
    const result = await listExistingDailyNotes([dates[0]], { vaultPath: VAULT, adapter: { exists } });
    expect(checked).toEqual(["Journal/05.03.2024.md"]);
    // The returned key stays the ISO calendar key regardless of the note filename format.
    expect(result).toEqual(new Set(["2024-03-05"]));
  });

  it("does not report a partial scan as a complete set of daily notes", async () => {
    const exists = vi.fn(async (p: string) => {
      if (p === "2024-03-06.md") throw new Error("fs error");
      return true;
    });
    await expect(listExistingDailyNotes(dates, { vaultPath: VAULT, adapter: { exists } })).rejects.toThrow("fs error");
  });

  it("returns an empty set when nothing exists", async () => {
    const exists = vi.fn(async () => false);
    const result = await listExistingDailyNotes(dates, { vaultPath: VAULT, adapter: { exists } });
    expect(result.size).toBe(0);
  });
});

describe("noteStamp", () => {
  it("keeps the note's day and takes the time from now", () => {
    const day = new Date(2024, 2, 5);
    const now = new Date(2026, 6, 29, 14, 37, 12, 500);
    const stamp = noteStamp(day, now);
    expect(stamp.getFullYear()).toBe(2024);
    expect(stamp.getMonth()).toBe(2);
    expect(stamp.getDate()).toBe(5);
    expect(stamp.getHours()).toBe(14);
    expect(stamp.getMinutes()).toBe(37);
  });

  it("does not mutate the day it was given", () => {
    const day = new Date(2024, 2, 5);
    noteStamp(day, new Date(2026, 6, 29, 9, 0, 0));
    expect(day.getHours()).toBe(0);
  });
});

describe("resolveOrCreateDailyNote — OKF write rule", () => {
  const VAULT = "/vault";
  const date = new Date(2024, 2, 5);

  function frontmatterOf(content: string): Record<string, unknown> {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) throw new Error("no frontmatter");
    return parseYaml(match[1]) as Record<string, unknown>;
  }

  function makeAdapter(files: Record<string, string>) {
    const written: Record<string, string> = {};
    return {
      written,
      adapter: {
        exists: async (p: string) => p in files,
        createDir: async () => {},
        writeTextFile: async (p: string, c: string) => {
          written[p] = c;
        },
        readTextFile: async (p: string) => files[p],
      },
    };
  }

  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  it("creates a template-less daily note with an OKF type (no per-note okf_version)", async () => {
    const { adapter, written } = makeAdapter({});
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    expect(path).toBe("2024-03-05.md");
    const fm = frontmatterOf(written[path!]);
    expect(fm.type).toBe("Daily Note");
    expect(fm.okf_version).toBeUndefined();
    // Blank daily notes start with an H1 of the date name (maintainer, 2026-07-04).
    expect(written[path!]).toContain("# 2024-03-05");
  });

  it("keeps a template's own type and still expands placeholders", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const { adapter, written } = makeAdapter({
      "Templates/daily.md": "---\ntype: Journal\n---\n\n# {{title}}\n",
    });
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    const content = written[path!];
    const fm = frontmatterOf(content);
    expect(fm.type).toBe("Journal");
    expect(fm.okf_version).toBeUndefined();
    expect(content).toContain("# 2024-03-05");
  });

  it("respects the configured daily note type", async () => {
    storeValues[dailyNoteTypeKey(VAULT)] = "Tagesnotiz";
    const { adapter, written } = makeAdapter({});
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    expect(frontmatterOf(written[path!]).type).toBe("Tagesnotiz");
  });

  // Plan Vorlagen-Engine, P0. The daily path used to run three raw replaces
  // instead of the shared engine, so template-only keys were inherited and
  // insert-time tokens stayed in the file verbatim.
  it("does not inherit the template-only plainva keys", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const { adapter, written } = makeAdapter({
      // Exactly what "create new template" writes, plus a database assignment.
      "Templates/daily.md": `---\ntype: Daily Note\nokf_version: "0.1"\nplainva:\n  tasks: false\n  templateFor:\n    - "[[Tasks.base]]"\n---\n\n# {{title}}\n\n- [ ] Erste Aufgabe\n`,
    });
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    const fm = frontmatterOf(written[path!]);
    // A daily note whose tasks are hidden from the Tasks view is the bug this
    // guards: `plainva.tasks: false` must not survive the copy.
    expect(fm.plainva ?? {}).not.toHaveProperty("tasks");
    expect(fm.plainva ?? {}).not.toHaveProperty("templateFor");
    // OKF v0.2: a legacy template's per-note okf_version does not travel either.
    expect(fm.okf_version).toBeUndefined();
    expect(written[path!]).toContain("- [ ] Erste Aufgabe");
  });

  // Finding 2026-10-11. The test above creates the note the way a capture
  // does, without questions. The daily-note button runs the template through
  // the shell's questions instead (`useDailyNoteAction`), and on that way the
  // keys were never taken out: every daily note a person opened from such a
  // template had its tasks hidden from the Tasks view.
  it("does not inherit them when a person opens the note either — the way that asks the template's questions", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const template = `---\ntype: Daily Note\nokf_version: "0.1"\nplainva:\n  tasks: false\n  icon: 🌅\n  templateFor:\n    - "[[Tasks.base]]"\n---\n\n# {{title}}\n\n- [ ] {{cursor}}Erste Aufgabe\n`;
    const asked = makeAdapter({ "Templates/daily.md": template });
    clearPendingTemplateCaret();
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter: asked.adapter,
      onIndex: async () => {},
      confirmCreate: false,
      resolveTemplate: (raw, ctx) => applyTemplateInteractive(raw, ctx, "Fragen"),
    });
    const note = asked.written[path!];
    const fm = frontmatterOf(note);
    expect(fm.plainva ?? {}).not.toHaveProperty("tasks");
    expect(fm.plainva ?? {}).not.toHaveProperty("templateFor");
    expect(fm.okf_version).toBeUndefined();
    // What is not meant for the template alone comes along, as it always did.
    expect(fm).toEqual({ type: "Daily Note", plainva: { icon: "🌅" } });
    expect(note).toContain("- [ ] Erste Aufgabe");
    // The caret is found behind the block that lost three entries.
    const parked = consumePendingTemplateCaret(path);
    expect(parked && note.slice(parked.offset)).toBe("Erste Aufgabe\n");

    // The same note, byte for byte, as the one a capture creates on its way.
    const quiet = makeAdapter({ "Templates/daily.md": template });
    const quietPath = await resolveOrCreateDailyNote(date, { vaultPath: VAULT, adapter: quiet.adapter, onIndex: async () => {}, confirmCreate: false });
    expect(note).toBe(quiet.written[quietPath!]);
  });

  it("gives the heading of a blank daily note to a template that leaves nothing of itself, on both ways", async () => {
    // A template that carries only what is meant for it — an empty note saved
    // as a template — says nothing about the note. A capture already wrote the
    // date as the heading then; opened by a person, the note was the
    // template's block and no heading.
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    for (const resolveTemplate of [undefined, (raw: string, ctx: { title: string; now: Date; folder: string }) => applyTemplateInteractive(raw, ctx, "Fragen")]) {
      const { adapter, written } = makeAdapter({ "Templates/daily.md": "---\nplainva:\n  tasks: false\n---\n" });
      const path = await resolveOrCreateDailyNote(date, { vaultPath: VAULT, adapter, onIndex: async () => {}, confirmCreate: false, resolveTemplate });
      expect(written[path!]).toBe("---\ntype: Daily Note\n---\n# 2024-03-05\n");
    }
    // A template with a property of its own is one, text or not: no heading is put under it.
    const { adapter, written } = makeAdapter({ "Templates/daily.md": "---\nmood:\nplainva:\n  tasks: false\n---\n" });
    const path = await resolveOrCreateDailyNote(date, { vaultPath: VAULT, adapter, onIndex: async () => {}, confirmCreate: false, resolveTemplate: (raw, ctx) => applyTemplateInteractive(raw, ctx, "Fragen") });
    expect(written[path!]).toBe("---\nmood:\ntype: Daily Note\n---\n");
  });

  it("never leaves {{cursor}} or {{prompt:…}} in the created note", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const { adapter, written } = makeAdapter({
      "Templates/daily.md": "## {{title}}\n\nStimmung: {{prompt:Stimmung}}\n\n{{cursor}}\n",
    });
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    const content = written[path!];
    expect(content).not.toContain("{{cursor}}");
    expect(content).not.toContain("{{prompt:");
  });

  it("interpolates {{date}} with the note's day and {{time}} with the current time", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const { adapter, written } = makeAdapter({ "Templates/daily.md": "{{date}} um {{time}}\n" });
    // A daily note created for a PAST day: the date must follow the note, the
    // time must stay the wall clock (a midnight reference would print 00:00).
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    const content = written[path!];
    expect(content).toContain("2024-03-05 um ");
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    expect(content).toContain(hhmm);
  });

  it("prepends frontmatter to a template without one, keeping the body", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    const { adapter, written } = makeAdapter({
      "Templates/daily.md": "## Plan für {{date}}\n",
    });
    const path = await resolveOrCreateDailyNote(date, {
      vaultPath: VAULT,
      adapter,
      onIndex: async () => {},
      confirmCreate: false,
    });
    const content = written[path!];
    expect(frontmatterOf(content).type).toBe("Daily Note");
    expect(content).toContain("## Plan für 2024-03-05");
    // A template defines the body — no extra H1 is injected.
    expect(content).not.toMatch(/^# /m);
  });

  // Finding 2026-10-09. The caret was parked as a place in the FILE; the
  // editor that opens the note holds it with `\n` line ends and without its
  // byte order mark, and a note keeps the line ends and the mark of its
  // template. Every line above the cursor moved the caret one to the right.
  it("parks the template's cursor as a place in the text the editor holds, whatever line ends and mark the template has", async () => {
    storeValues[templateFolderKey(VAULT)] = "Templates";
    storeValues[dailyNoteTemplateKey(VAULT)] = "daily.md";
    // Built at run time: the mark is never typed into this file.
    const mark = String.fromCharCode(0xfeff);
    const templates: Record<string, string> = {
      "\\n": "# {{title}}\n\n## Plan\n{{cursor}}\n## Abend\n",
      "\\n, block": "---\nstatus: offen\n---\n# {{title}}\n\n## Plan\n{{cursor}}\n## Abend\n",
      "\\r\\n": "# {{title}}\r\n\r\n## Plan\r\n{{cursor}}\r\n## Abend\r\n",
      "\\r\\n, block": "---\r\nstatus: offen\r\n---\r\n# {{title}}\r\n\r\n## Plan\r\n{{cursor}}\r\n## Abend\r\n",
      mark: `${mark}# {{title}}\n\n## Plan\n{{cursor}}\n## Abend\n`,
      "mark, block": `${mark}---\nstatus: offen\n---\n# {{title}}\n\n## Plan\n{{cursor}}\n## Abend\n`,
      "mark and \\r\\n, block": `${mark}---\r\nstatus: offen\r\n---\r\n# {{title}}\r\n\r\n## Plan\r\n{{cursor}}\r\n## Abend\r\n`,
    };
    for (const [name, template] of Object.entries(templates)) {
      clearPendingTemplateCaret();
      const { adapter, written } = makeAdapter({ "Templates/daily.md": template });
      const path = await resolveOrCreateDailyNote(date, {
        vaultPath: VAULT,
        adapter,
        onIndex: async () => {},
        confirmCreate: false,
        // A person opens the note: the template runs through the interactive
        // pipeline, as `useDailyNoteAction` wires it.
        resolveTemplate: (raw, ctx) => applyTemplateInteractive(raw, ctx, "Fragen"),
      });
      const note = written[path!];
      // The note keeps what the template has …
      expect(note.includes("\r\n"), name).toBe(template.includes("\r\n"));
      expect(note.startsWith(mark), name).toBe(template.startsWith(mark));
      expect(frontmatterOf(note.slice(note.startsWith(mark) ? 1 : 0)).type, name).toBe("Daily Note");
      // … and its editor is handed the place in what IT holds.
      const parked = consumePendingTemplateCaret(path);
      expect(parked && editorTextOf(note).slice(parked.offset), name).toBe("\n## Abend\n");
    }
  });
});

describe("makeDailyPathProvider", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  it("resolves the daily note that many days from the reference instant", async () => {
    storeValues[dailyNotesFolderKey("/v")] = "Tagebuch";
    storeValues[dailyNotesFormatKey("/v")] = "YYYY-MM-DD";
    const path = await makeDailyPathProvider("/v", new Date(2026, 6, 29));
    // The PATH, without brackets: the engine builds the link, so that
    // `{{daily+1:Label}}` can put an alias into it.
    expect(path(0)).toBe("Tagebuch/2026-07-29");
    expect(path(1)).toBe("Tagebuch/2026-07-30");
    // Across a month boundary, which is why this counts in days and not in
    // string arithmetic.
    expect(path(3)).toBe("Tagebuch/2026-08-01");
    expect(path(-29)).toBe("Tagebuch/2026-06-30");
  });

  it("carries the folder, and omits it only when there is none", async () => {
    const path = await makeDailyPathProvider("/v", new Date(2026, 6, 29));
    expect(path(0)).toBe("2026-07-29");
  });

  it("follows the configured date format", async () => {
    storeValues[dailyNotesFormatKey("/v")] = "DD.MM.YYYY";
    const path = await makeDailyPathProvider("/v", new Date(2026, 6, 29));
    expect(path(0)).toBe("29.07.2026");
  });
});
