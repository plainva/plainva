import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendJournalEntry,
  appendPlannedJournalEntry,
  deleteJournalEntry,
  editJournalEntry,
  ensureDailyNote,
  setJournalEntryTaskState,
  setPlatformServices,
  toggleJournalEntryTask,
  undoJournalChange,
  type DailyNoteCreateConfig,
  type JournalFiles,
} from "@plainva/ui";
import { parseJournal } from "@plainva/core";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";

/**
 * Plan Journal, J2: the one write path both shells use — against real files.
 */

const DAY = new Date(2026, 8, 20);
const NOW = new Date(2026, 8, 20, 14, 5, 30);
const PATH = "Journal/2026-09-20.md";
const CONFIG: DailyNoteCreateConfig = { folder: "Journal", format: "YYYY-MM-DD", templateFolder: "Templates", template: "Daily.md", noteType: "Daily Note" };

let root: string;
let vault: LocalVaultAdapter;

/** What a shell hands in: its adapter, and the shared daily-note rule run headless. */
function filesOf(adapter: LocalVaultAdapter, config: DailyNoteCreateConfig = CONFIG): JournalFiles {
  return {
    ensureDailyNote: (date) => ensureDailyNote(date, config, {
      exists: (path) => adapter.exists(path),
      readTextFile: (path) => adapter.readTextFile(path),
      createNote: async (path, content) => {
        const folder = path.split("/").slice(0, -1).join("/");
        if (folder && !(await adapter.exists(folder))) await adapter.createDir(folder);
        await adapter.writeTextFile(path, content);
      },
    }, { now: NOW }),
    readTextFile: (path) => adapter.readTextFile(path),
    writeTextFile: (path, content) => adapter.writeTextFile(path, content),
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-journal-"));
  vault = new LocalVaultAdapter(root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("appendJournalEntry", () => {
  it("creates the missing daily note from the template without asking, then appends", async () => {
    await vault.createDir("Templates");
    await vault.writeTextFile("Templates/Daily.md", "---\ndate: {{date}}\nplainva:\n  tasks: false\n---\n# {{title}}\n\nMood: {{prompt:Mood}}\n{{cursor}}\n## Journal\n\n## Notes\n");
    const result = await appendJournalEntry(filesOf(vault), { date: DAY, text: "First thought #idea", heading: "Journal", now: NOW });
    expect(result.ok && result.createdNote).toBe(true);
    const written = await vault.readTextFile(PATH);
    expect(written).toContain("date: 2026-09-20");
    // The question resolves to nothing, the cursor token is gone, the template-only key is not inherited.
    expect(written).toContain("Mood: \n");
    expect(written).not.toMatch(/\{\{|tasks: false/);
    expect(written).toContain("## Journal\n\n- 14:05 First thought #idea\n\n## Notes\n");
    expect(result.ok && result.entry).toMatchObject({ time: "14:05", text: "First thought #idea", tags: ["idea"], task: null });
  });

  it("creates a blank daily note and the journal section when there is no template", async () => {
    const result = await appendJournalEntry(filesOf(vault, { ...CONFIG, template: "" }), { date: DAY, text: "Hello", heading: "Journal", now: NOW });
    expect(result.ok).toBe(true);
    const written = await vault.readTextFile(PATH);
    expect(written).toMatch(/^---\n[\s\S]*type: Daily Note[\s\S]*---\n/);
    expect(written.endsWith("# 2026-09-20\n\n## Journal\n\n- 14:05 Hello\n")).toBe(true);
  });

  it("appends to an existing note and leaves every other byte alone", async () => {
    await vault.createDir("Journal");
    const before = "# Sunday\r\n\r\n## Journal\r\n- 09:00 early\r\n\r\n## Notes\r\nkeep me\r\n";
    await vault.writeTextFile(PATH, before);
    const result = await appendJournalEntry(filesOf(vault), { date: DAY, text: "later", heading: "Journal", task: true, now: NOW });
    expect(result.ok && result.createdNote).toBe(false);
    expect(await vault.readTextFile(PATH)).toBe("# Sunday\r\n\r\n## Journal\r\n- 09:00 early\r\n- [ ] 14:05 later\r\n\r\n## Notes\r\nkeep me\r\n");
  });

  it("redoes the change when the note moved on between reading and writing", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n- 09:00 early\n");
    const files = filesOf(vault);
    let reads = 0;
    const racing: JournalFiles = {
      ...files,
      readTextFile: async (path) => {
        // Another writer — a sync pull, the editor's autosave — lands right after the first read.
        if (++reads === 2) await vault.writeTextFile(PATH, "## Journal\n- 09:00 early\n- 13:00 from the other device\n");
        return files.readTextFile(path);
      },
    };
    const result = await appendJournalEntry(racing, { date: DAY, text: "mine", heading: "Journal", now: NOW });
    expect(result.ok).toBe(true);
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n- 09:00 early\n- 13:00 from the other device\n- 14:05 mine\n");
  });

  it("gives up rather than overwrite a note that never holds still", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n");
    const files = filesOf(vault);
    let n = 0;
    const restless: JournalFiles = { ...files, readTextFile: async () => `## Journal\n- 09:00 version ${n++}\n` };
    expect(await appendJournalEntry(restless, { date: DAY, text: "mine", heading: "Journal", now: NOW })).toEqual({ ok: false, reason: "changed" });
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n");
  });

  it("refuses an empty text and reports a note that cannot be created", async () => {
    expect(await appendJournalEntry(filesOf(vault), { date: DAY, text: "  \n", heading: "Journal" })).toEqual({ ok: false, reason: "empty" });
    const files: JournalFiles = { ...filesOf(vault), ensureDailyNote: async () => null };
    expect(await appendJournalEntry(files, { date: DAY, text: "x", heading: "Journal" })).toEqual({ ok: false, reason: "no-note" });
  });

  it("lets a refused write surface — a read-only member of a workspace writes nothing", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n");
    const readOnly: JournalFiles = { ...filesOf(vault), writeTextFile: async () => { throw new Error("workspace_write_denied"); } };
    await expect(appendJournalEntry(readOnly, { date: DAY, text: "x", heading: "Journal", now: NOW })).rejects.toThrow("workspace_write_denied");
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n");
  });
});

describe("appendPlannedJournalEntry — the share target plans before it writes", () => {
  const planned = { date: "2026-09-20", time: "14:05", heading: "Journal", text: "Agenda\nhttps://example.test/agenda\n![[Attachments/Shared/x/1-sketch.png]]" };

  it("writes the planned entry with the planned time, into the note of the planned day", async () => {
    const path = await appendPlannedJournalEntry(filesOf(vault, { ...CONFIG, template: "" }), planned);
    expect(path).toBe(PATH);
    expect(await vault.readTextFile(PATH)).toContain("- 14:05 Agenda\n  https://example.test/agenda\n  ![[Attachments/Shared/x/1-sketch.png]]\n");
  });

  it("is idempotent: a retry after a crash finds its own entry and writes nothing", async () => {
    const files = filesOf(vault, { ...CONFIG, template: "" });
    await appendPlannedJournalEntry(files, planned);
    const once = await vault.readTextFile(PATH);
    expect(await appendPlannedJournalEntry(files, planned)).toBe(PATH);
    expect(await vault.readTextFile(PATH)).toBe(once);
    // Another share in the same minute is another entry.
    await appendPlannedJournalEntry(files, { ...planned, text: "Something else" });
    expect(parseJournal(await vault.readTextFile(PATH)).entries.map((e) => e.text.split("\n")[0])).toEqual(["Agenda", "Something else"]);
  });

  it("resolves with null for an entry that cannot be written", async () => {
    expect(await appendPlannedJournalEntry(filesOf(vault), { ...planned, time: "25:00" })).toBeNull();
    expect(await appendPlannedJournalEntry({ ...filesOf(vault), ensureDailyNote: async () => null }, planned)).toBeNull();
  });
});

describe("undo", () => {
  it("takes a capture back byte for byte while nothing else touched the note", async () => {
    await vault.createDir("Journal");
    const before = "# Sunday\n\ntext without a journal";
    await vault.writeTextFile(PATH, before);
    const files = filesOf(vault);
    const result = await appendJournalEntry(files, { date: DAY, text: "oops", heading: "Journal", now: NOW });
    if (!result.ok || !result.undo) throw new Error("capture failed");
    expect(await vault.readTextFile(PATH)).toBe("# Sunday\n\ntext without a journal\n\n## Journal\n\n- 14:05 oops");
    expect(await undoJournalChange(files, result.undo, "Journal")).toBe(true);
    expect(await vault.readTextFile(PATH)).toBe(before);
  });

  it("takes only the entry out once somebody else wrote to the note", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n- 09:00 early\n");
    const files = filesOf(vault);
    const result = await appendJournalEntry(files, { date: DAY, text: "oops", heading: "Journal", now: NOW });
    if (!result.ok || !result.undo) throw new Error("capture failed");
    await vault.writeTextFile(PATH, "# A title from the other device\n\n## Journal\n- 09:00 early\n- 14:05 oops\n- 14:06 theirs\n");
    expect(await undoJournalChange(files, result.undo, "Journal")).toBe(true);
    expect(await vault.readTextFile(PATH)).toBe("# A title from the other device\n\n## Journal\n- 09:00 early\n- 14:06 theirs\n");
  });

  it("puts a deleted entry back in its place", async () => {
    await vault.createDir("Journal");
    const before = "## Journal\n- 09:00 a\n- 10:00 b\n  more\n- 11:00 c\n";
    await vault.writeTextFile(PATH, before);
    const files = filesOf(vault);
    const entry = parseJournal(before).entries[1];
    const removed = await deleteJournalEntry(files, { path: PATH, entry, heading: "Journal" });
    if (!removed.ok || !removed.undo) throw new Error("delete failed");
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n- 09:00 a\n- 11:00 c\n");
    await vault.writeTextFile(PATH, "## Journal\n- 09:00 a\n- 11:00 c\n- 12:00 d\n");
    expect(await undoJournalChange(files, removed.undo, "Journal")).toBe(true);
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n- 09:00 a\n- 10:00 b\n  more\n- 11:00 c\n- 12:00 d\n");
  });

  it("reports when there is nothing left to undo", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n");
    const files = filesOf(vault);
    const result = await appendJournalEntry(files, { date: DAY, text: "gone", heading: "Journal", now: NOW });
    if (!result.ok || !result.undo) throw new Error("capture failed");
    await vault.writeTextFile(PATH, "## Journal\n- 15:00 something else entirely\n");
    expect(await undoJournalChange(files, result.undo, "Journal")).toBe(false);
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n- 15:00 something else entirely\n");
  });
});

describe("changing an entry", () => {
  const NOTE = "## Journal\n- 09:00 first\n- [ ] 10:00 call back 📅 2026-09-21\n";

  it("edits in place, converts to a task and ticks it off", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, NOTE);
    const files = filesOf(vault);
    const [first, second] = parseJournal(NOTE).entries;

    const edited = await editJournalEntry(files, { path: PATH, entry: first, heading: "Journal" }, { text: "first, rewritten" });
    expect(edited.ok && edited.entry.text).toBe("first, rewritten");

    const converted = await setJournalEntryTaskState(files, { path: PATH, entry: edited.ok ? edited.entry : first, heading: "Journal" }, "open");
    expect(converted.ok && converted.entry.task).toBe("open");

    // `second` was read before the two changes above — it is found again by its spelling.
    const ticked = await toggleJournalEntryTask(files, { path: PATH, entry: second, heading: "Journal" }, { today: "2026-09-20" });
    expect(ticked.ok && ticked.entry.task).toBe("done");
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n- [ ] 09:00 first, rewritten\n- [x] 10:00 call back 📅 2026-09-21 ✅ 2026-09-20\n");
  });

  it("says so when the entry is gone", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n- 12:00 other\n");
    const entry = parseJournal(NOTE).entries[0];
    expect(await editJournalEntry(filesOf(vault), { path: PATH, entry, heading: "Journal" }, { text: "x" })).toEqual({ ok: false, reason: "missing" });
  });
});

describe("an open editor is part of the write path", () => {
  // The rule of every shared write (graph actions, mention linking): the open
  // editor's pending save goes to disk BEFORE the note is read. Without it that
  // save overwrites the entry a second later, or the two meet as a conflict.
  afterEach(() => setPlatformServices(null as never));

  it("flushes the editor's unsaved typing first, so the entry lands on top of it and nothing is lost", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "# Sunday\n\n## Journal\n\n- 09:00 first\n");
    const order: string[] = [];
    // The editor holds a sentence that is not on disk yet; the flush writes it.
    setPlatformServices({
      flushPendingSave: async (path: string) => {
        order.push(`flush:${path}`);
        const disk = await vault.readTextFile(path);
        if (!disk.includes("typed and unsaved")) await vault.writeTextFile(path, disk.replace("# Sunday\n", "# Sunday\n\ntyped and unsaved\n"));
      },
    } as never);
    const files = filesOf(vault);
    const spied: JournalFiles = { ...files, readTextFile: async (path) => { order.push("read"); return files.readTextFile(path); } };

    const result = await appendJournalEntry(spied, { date: DAY, text: "second", heading: "Journal", now: NOW });

    expect(result.ok).toBe(true);
    expect(order[0]).toBe(`flush:${PATH}`);
    expect(order.indexOf("read")).toBeGreaterThan(0);
    expect(await vault.readTextFile(PATH)).toBe("# Sunday\n\ntyped and unsaved\n\n## Journal\n\n- 09:00 first\n- 14:05 second\n");
  });

  it("does the same before an edit, a delete and an undo", async () => {
    await vault.createDir("Journal");
    await vault.writeTextFile(PATH, "## Journal\n\n- 09:00 first\n- 10:00 second\n");
    const flushed: string[] = [];
    setPlatformServices({ flushPendingSave: async (path: string) => void flushed.push(path) } as never);
    const files = filesOf(vault);
    const entry = (raw: string, time: string) => parseJournal(raw, { heading: "Journal" }).entries.find((e) => e.time === time)!;

    const edited = await editJournalEntry(files, { path: PATH, entry: entry(await vault.readTextFile(PATH), "09:00"), heading: "Journal" }, { text: "first, reworded" });
    expect(edited.ok).toBe(true);
    const removed = await deleteJournalEntry(files, { path: PATH, entry: entry(await vault.readTextFile(PATH), "10:00"), heading: "Journal" });
    expect(removed.ok && removed.undo).toBeTruthy();
    expect(await undoJournalChange(files, (removed as { undo: NonNullable<unknown> }).undo as never, "Journal")).toBe(true);

    expect(flushed).toEqual([PATH, PATH, PATH]);
    expect(await vault.readTextFile(PATH)).toBe("## Journal\n\n- 09:00 first, reworded\n- 10:00 second\n");
  });
});
