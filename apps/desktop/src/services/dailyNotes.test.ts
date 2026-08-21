import { describe, it, expect, vi, beforeEach } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildDailyNotePath } from "@plainva/ui";
import { listExistingDailyNotes, makeDailyPathProvider, noteStamp, resolveOrCreateDailyNote } from "./dailyNotes";
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

  it("skips dates whose existence check throws instead of failing the whole scan", async () => {
    const exists = vi.fn(async (p: string) => {
      if (p === "2024-03-06.md") throw new Error("fs error");
      return true;
    });
    const result = await listExistingDailyNotes(dates, { vaultPath: VAULT, adapter: { exists } });
    expect(result).toEqual(new Set(["2024-03-05", "2024-03-07"]));
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
