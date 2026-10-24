import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PimEventRow } from "@plainva/core";
import {
  buildMeetingNoteFromTemplate,
  buildNewItemContent,
  dailyPathFrom,
  ensureDailyNote,
  parseBaseConfig,
  resolveTemplate,
  runTemplateInteractive,
  serializeBaseConfig,
  setPlatformServices,
  withPersonContext,
  withVaultContext,
  type DailyNoteCreateConfig,
  type TaskDbLabels,
  type TemplateContext,
  type TemplateShell,
  type TemplateVault,
} from "@plainva/ui";
import { createTaskInDatabase, promoteTask } from "./taskPromotion";
import { buildTaskDbFile } from "./taskDatabase";

/**
 * What a template is resolved WITH, and where each piece comes from
 * (Sammelplan § 3.97).
 *
 * Every way of both shells takes its context from the shared module
 * `templateContext.ts`: the vault's pieces for every template — its name, the
 * daily notes counted from the day a note is for, the week start as the device
 * is set — and a person's pieces for a template a person triggered. Before,
 * each caller filled the context itself, and the ways below left pieces out.
 * The shells' own ways are driven in `apps/desktop/src/dailyNoteTemplateContext.test.tsx`,
 * `apps/mobile/src/services/dailyNoteTemplateContext.test.ts` and the composer
 * tests; the database's "+ Entry" and the pinboard in `e2e/base.spec.ts`.
 *
 * The dates: 2026-10-11 is a Sunday. Where the week starts on Sunday, the
 * Monday of its week is the 12th; where it starts on Monday, the 5th — the
 * week start shows only on such a day.
 */

const SUNDAY = new Date(2026, 9, 11, 9, 30);
const VAULT: TemplateVault = { name: "Vault", dailyFolder: "Journal", dailyFormat: "YYYY-MM-DD" };

let weekStart: unknown = "sunday";
beforeEach(() => {
  weekStart = "sunday";
  setPlatformServices({
    loadSettings: async () => ({ get: async (key: string) => (key === "calendarWeekStart" ? weekStart : null) }),
    credentials: {},
    openExternal: async () => {},
  } as never);
});
afterEach(() => {
  setPlatformServices(null as never);
  vi.useRealTimers();
});

const fill = (text: string, ctx: TemplateContext) => resolveTemplate(text, ctx, "headless").text;

describe("the pieces every template is owed (withVaultContext)", () => {
  it("adds the vault's name, the daily notes counted from the day of `now`, and the week start as this device is set", async () => {
    const ctx = await withVaultContext({ title: "T", now: SUNDAY }, VAULT);
    expect(fill("{{vault}} · {{daily-1}} · {{daily}} · {{daily+1:morgen}} · {{weekday:monday}}", ctx)).toBe(
      "Vault · [[Journal/2026-10-10]] · [[Journal/2026-10-11]] · [[Journal/2026-10-12|morgen]] · 2026-10-12"
    );
  });

  it("builds the daily paths by the rule a daily note is created by: trimmed, with the default format when there is none", () => {
    const path = dailyPathFrom(SUNDAY, { dailyFolder: " Tagebuch/ ", dailyFormat: "  " });
    expect(path(0)).toBe("Tagebuch/2026-10-11");
    // Across a month boundary: counted in days.
    expect(path(21)).toBe("Tagebuch/2026-11-01");
    expect(dailyPathFrom(SUNDAY, { dailyFolder: "", dailyFormat: "DD.MM.YYYY" })(-1)).toBe("10.10.2026");
  });

  it("keeps every piece the caller set", async () => {
    const meetingDay = (offset: number) => `Meetings/${offset}`;
    const ctx = await withVaultContext({ title: "T", now: SUNDAY, vaultName: "Eigen", dailyPath: meetingDay, weekStart: 1 }, VAULT);
    expect(fill("{{vault}} {{daily}} {{weekday:monday}}", ctx)).toBe("Eigen [[Meetings/0]] 2026-10-05");
  });

  it("without a vault adds the week start alone", async () => {
    const ctx = await withVaultContext({ title: "T", now: SUNDAY }, null);
    expect(fill("[{{vault}}] {{daily}} {{weekday:monday}}", ctx)).toBe("[] {{daily}} 2026-10-12");
  });

  it("counts from Monday where the setting says so, or cannot be read", async () => {
    weekStart = "monday";
    expect(fill("{{weekday:monday}}", await withVaultContext({ title: "T", now: SUNDAY }, VAULT))).toBe("2026-10-05");
    setPlatformServices(null as never);
    expect(fill("{{weekday:monday}}", await withVaultContext({ title: "T", now: SUNDAY }, VAULT))).toBe("2026-10-05");
  });
});

describe("what a person brings (withPersonContext)", () => {
  const sources = (clipboard: () => Promise<string | null>) => ({
    selection: () => "markiert",
    readClipboard: vi.fn(clipboard),
    clipboardLabel: "Zwischenablage",
  });

  it("reads the clipboard only for a template that carries the token", async () => {
    const without = sources(async () => "geheim");
    await withPersonContext("{{title}}", { title: "T", now: SUNDAY }, without);
    expect(without.readClipboard).not.toHaveBeenCalled();
    // An escaped token is text, not a request for the clipboard.
    await withPersonContext("So schreibt man ihn: \\{{clipboard}}", { title: "T", now: SUNDAY }, without);
    expect(without.readClipboard).not.toHaveBeenCalled();

    const withToken = sources(async () => "aus der Ablage");
    const ctx = await withPersonContext("{{clipboard}}", { title: "T", now: SUNDAY }, withToken);
    expect(withToken.readClipboard).toHaveBeenCalledTimes(1);
    // Never written silently: it arrives as a pre-filled question.
    const resolved = resolveTemplate("{{clipboard}} / {{selection}}", ctx, "interactive");
    expect(resolved.requests).toEqual([{ label: "Zwischenablage", kind: "text", defaultValue: "aus der Ablage" }]);
    expect(resolved.text).toBe("{{prompt:Zwischenablage}} / markiert");
  });

  it("a clipboard that refuses to be read leaves the token unresolved, without a question", async () => {
    const ctx = await withPersonContext("{{clipboard}}", { title: "T", now: SUNDAY }, sources(async () => { throw new Error("denied"); }));
    const resolved = resolveTemplate("[{{clipboard}}]", ctx, "interactive");
    expect(resolved).toMatchObject({ text: "[]", requests: [], unresolved: ["{{clipboard}}"] });
  });
});

describe("the pipeline with questions of both shells (runTemplateInteractive)", () => {
  const shell = (answer: Record<string, string> | null): TemplateShell & { asked: string[][] } => {
    const asked: string[][] = [];
    return {
      asked,
      vault: VAULT,
      person: { selection: () => null, readClipboard: async () => "kopiert", clipboardLabel: "Zwischenablage" },
      ask: async (fields) => {
        asked.push(fields.map((f) => f.label));
        return answer;
      },
    };
  };

  it("asks every question once, the clipboard among them, and fills the rest from the full context", async () => {
    const s = shell({ Wer: "Kim", Zwischenablage: "kopiert" });
    const result = await runTemplateInteractive("{{prompt:Wer}} · {{clipboard}} · {{daily}} · {{weekday:monday}}{{cursor}}", { title: "T", now: SUNDAY }, s);
    expect(s.asked).toEqual([["Wer", "Zwischenablage"]]);
    const text = "Kim · kopiert · [[Journal/2026-10-11]] · 2026-10-12";
    expect(result).toEqual({ text, cursor: text.length });
  });

  it("opens no dialog for a template without questions, and returns null when it is cancelled", async () => {
    const quiet = shell(null);
    expect(await runTemplateInteractive("# {{title}}", { title: "T", now: SUNDAY }, quiet)).toEqual({ text: "# T", cursor: null });
    expect(quiet.asked).toEqual([]);
    expect(await runTemplateInteractive("{{prompt:X}}", { title: "T", now: SUNDAY }, quiet)).toBeNull();
  });
});

describe("a meeting note, through the pipeline of both shells", () => {
  // The shells used to hand the meeting note a daily-path provider of its own,
  // counted from the meeting's day. The pipeline counts from the note's `now`,
  // which the meeting note sets to that day — this pins it.
  it("links `{{daily}}` to the daily note of the meeting's day, not of the day it is written", async () => {
    const shell: TemplateShell = { vault: VAULT, person: { selection: () => null, readClipboard: async () => null, clipboardLabel: "Clipboard" }, ask: async () => ({}) };
    const event = { accountId: "acc-1", calendarId: "cal-1", uid: "uid-1", title: "Planung", start: { ts: new Date(2026, 9, 14, 10).getTime() }, end: { ts: new Date(2026, 9, 14, 11).getTime() }, allDay: false } as PimEventRow;
    const note = await buildMeetingNoteFromTemplate("Tag: {{daily}} · {{date}}\n", {
      event,
      dayKey: "2026-10-14",
      noteType: "Meeting",
      folder: "Meetings",
      now: SUNDAY,
      resolveTemplate: (raw, ctx) => runTemplateInteractive(raw, ctx, shell),
    });
    expect(note!.content).toContain("Tag: [[Journal/2026-10-14]] · 2026-10-14\n");
  });
});

describe("a daily note, by the block both shells create it with (ensureDailyNote)", () => {
  const CONFIG: DailyNoteCreateConfig = { folder: "Journal", format: "YYYY-MM-DD", templateFolder: "Vorlagen", template: "Tag.md", noteType: "Daily Note" };
  const TEMPLATE = "{{daily-1}} · {{date}} · {{daily+1}}\nMontag: {{weekday:monday}}\n";
  function memoryFiles() {
    const written: Record<string, string> = {};
    return {
      written,
      files: {
        exists: async (path: string) => path === "Vorlagen/Tag.md",
        readTextFile: async () => TEMPLATE,
        createNote: async (path: string, content: string) => void (written[path] = content),
      },
    };
  }

  // Finding 2026-10-11 (§ 3.97 Nr. 2 and 3): the phone gave neither way the
  // daily links, and nobody gave the capture's way the week start.
  it("a capture's daily note gets the daily links from the note's day and the week start, on both shells alike", async () => {
    const { files, written } = memoryFiles();
    await ensureDailyNote(new Date(2026, 9, 11), CONFIG, files, { now: new Date(2026, 9, 13, 8, 0), templateContext: { vaultName: "Vault" } });
    expect(written["Journal/2026-10-11.md"]).toBe("---\ntype: Daily Note\n---\n[[Journal/2026-10-10]] · 2026-10-11 · [[Journal/2026-10-12]]\nMontag: 2026-10-12\n");
  });

  it("a person's daily note hands the shell's pipeline the daily links from the note's day", async () => {
    const { files } = memoryFiles();
    let handed: TemplateContext | null = null;
    await ensureDailyNote(new Date(2026, 9, 11), CONFIG, files, {
      now: new Date(2026, 9, 13, 8, 0),
      resolveTemplate: async (raw, ctx) => {
        handed = ctx;
        return { text: raw, cursor: null };
      },
    });
    expect(handed!.title).toBe("2026-10-11");
    expect(handed!.folder).toBe("Journal");
    expect([handed!.dailyPath?.(-1), handed!.dailyPath?.(1)]).toEqual(["Journal/2026-10-10", "Journal/2026-10-12"]);
  });

  it("a piece the caller hands in still wins", async () => {
    const { files, written } = memoryFiles();
    await ensureDailyNote(new Date(2026, 9, 11), CONFIG, files, { templateContext: { vaultName: "Vault", dailyPath: (n) => `Anders/${n}`, weekStart: 1 } });
    expect(written["Journal/2026-10-11.md"]).toContain("[[Anders/-1]] · 2026-10-11 · [[Anders/1]]\nMontag: 2026-10-05\n");
  });
});

describe("an entry made in the background (task sync, a promoted checkbox, a task from a mail)", () => {
  const DB_LABELS: TaskDbLabels = { viewTable: "Tabelle", viewBoard: "Board", viewTimeline: "Zeitleiste", doneKey: "erledigt", dueKey: "frist", statusOptions: ["Offen", "In Arbeit", "Erledigt"] };
  const TEMPLATE = "Ordner: [{{folder}}] · Vault: [{{vault}}] · Tag: {{daily}} · Montag: {{weekday:monday}}\n";
  /** The task database of the tests, with a template of its own (kept in its first view). */
  function vaultWithTemplate(seed: Record<string, string> = {}) {
    const base = serializeBaseConfig({ ...parseBaseConfig(buildTaskDbFile("Aufgaben", DB_LABELS).content), newItemTemplate: "Vorlagen/Aufgabe.md" });
    const files = new Map<string, string>(Object.entries({ "Aufgaben.base": base, "Vorlagen/Aufgabe.md": TEMPLATE, ...seed }));
    return {
      files,
      adapter: {
        readTextFile: async (path: string) => {
          const text = files.get(path);
          if (text === undefined) throw new Error(`not found: ${path}`);
          return text;
        },
        writeTextFile: async (path: string, text: string) => void files.set(path, text),
        exists: async (path: string) => files.has(path),
      },
    };
  }
  const RESOLVED = "Ordner: [Aufgaben] · Vault: [Vault] · Tag: [[Journal/2026-10-11]] · Montag: 2026-10-12\n";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SUNDAY);
  });

  it("the shared builder fills what it is handed", () => {
    const content = buildNewItemContent({
      templateText: TEMPLATE,
      noteType: "Task",
      title: "Aufgabe",
      inheritTags: [],
      prefills: {},
      templateContext: { folder: "Aufgaben", vaultName: "Vault", dailyPath: dailyPathFrom(SUNDAY, VAULT), weekStart: 0 },
    });
    expect(content.endsWith(RESOLVED)).toBe(true);
  });

  it("a promoted checkbox: the note's folder, the vault and its daily note", async () => {
    const { adapter, files } = vaultWithTemplate({ "Notes/Plan.md": "- [ ] Anrufen\n" });
    const res = await promoteTask({
      adapter: adapter as never,
      sourcePath: "Notes/Plan.md",
      task: { ordinal: 0, text: "Anrufen", tags: [], due: null, done: false },
      dbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: ["Notes/Plan.md"],
      fallbackTitle: "Aufgabe",
      templateVault: VAULT,
    });
    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Anrufen.md" });
    expect(files.get("Aufgaben/Anrufen.md")!.endsWith(RESOLVED)).toBe(true);
  });

  it("a task created in the database (Tasks view, a mail, a comment): the same", async () => {
    const { adapter, files } = vaultWithTemplate();
    const res = await createTaskInDatabase({ adapter: adapter as never, dbPath: "Aufgaben.base", title: "Antworten", noteType: "Task", templateVault: VAULT });
    expect(res).toMatchObject({ ok: true, notePath: "Aufgaben/Antworten.md" });
    expect(files.get("Aufgaben/Antworten.md")!.endsWith(RESOLVED)).toBe(true);
  });
});
