// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  parseJournal,
  selectNoteFragment,
  updateVaultText,
  type IDatabaseAdapter,
  type TextChange,
  type TextFileUpdate,
} from "@plainva/core";
import {
  deleteJournalEntry,
  editJournalEntry,
  ensureDailyNote,
  markdownToPlainText,
  noteEmbedPreview,
  parseHeadings,
  setJournalEntryTaskState,
  toast,
  toggleJournalEntryTask,
  undoJournalChange,
} from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { ExternalVaultAdapter } from "../adapters/ExternalVaultAdapter";
import { fakeVaultFolder, folderBytes } from "../adapters/fakeVaultFolder";
import type { MobileVault } from "./vaultService";

/**
 * The phone's journal and a daily note that starts with a byte order mark
 * (finding 2026-10-09) — the twin of the desktop's journalByteOrderMark.test.ts.
 *
 * On the phone such a note is met in a folder the user picked on the device:
 * its adapter hands out a file's text with the mark, as the desktop's does
 * (`textOfFileBytes`). The journal answered "this entry cannot be placed" for
 * it and read no entry in it — the capture sheet, a share into the journal and
 * the widget's order all failed for that day, and the day showed empty.
 *
 * What runs here is the phone's own way: its journal service
 * (`journalService.ts`), the four vault operations it writes through — read
 * from `vaultService.ts`, which boots the native vault when it is imported —,
 * the adapter chain `boot()` puts over a picked folder, and under it a fake of
 * the native folder plugin. What is asserted are the bytes the plugin was
 * handed: the mark, and behind it what the same step leaves in a note without.
 */

const SETTINGS = { journalHeading: "Journal", dailyFolder: "Journal", dailyFormat: "YYYY-MM-DD", templateFolder: "Templates", dailyTemplate: "", dailyNoteType: "Daily Note" };

type PhoneOps = {
  read(v: MobileVault, path: string): Promise<string>;
  save(v: MobileVault, path: string, text: string): Promise<void>;
  update(v: MobileVault, path: string, change: TextChange): Promise<TextFileUpdate>;
  ensureDailyNote(v: MobileVault, date: Date, mode?: "interactive" | "headless"): Promise<{ path: string; created: boolean } | null>;
};
const phone = vi.hoisted(() => ({ ops: null as unknown }));
const ops = () => phone.ops as PhoneOps;
vi.mock("./vaultService", () => {
  const real = () => phone.ops as PhoneOps;
  return {
    vaultOps: {
      read: (v: MobileVault, path: string) => real().read(v, path),
      save: (v: MobileVault, path: string, text: string) => real().save(v, path, text),
      update: (v: MobileVault, path: string, change: TextChange) => real().update(v, path, change),
      ensureDailyNote: (v: MobileVault, date: Date, mode?: "interactive" | "headless") => real().ensureDailyNote(v, date, mode),
    },
  };
});
vi.mock("./syncService", () => ({ syncSoon: vi.fn() }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => SETTINGS }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

import { appendPlannedJournalEntry, captureJournalEntry, journalFiles, journalHeading } from "./journalService";
import { configuredDailyNoteType } from "./newNote";

/** `vaultOps.read`, `.save`, `.update` and `.ensureDailyNote` as `vaultService.ts` defines them, run against the scope they need. */
function phoneOps(): PhoneOps {
  const file = ts.createSourceFile("vaultService.ts", readFileSync(resolve("src/services/vaultService.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const wanted = ["read", "save", "update", "ensureDailyNote"];
  const methods = new Map<string, string>();
  const ofVaultOps = (node: ts.MethodDeclaration) =>
    ts.isObjectLiteralExpression(node.parent) && ts.isVariableDeclaration(node.parent.parent) && node.parent.parent.name.getText(file) === "vaultOps";
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && wanted.includes(node.name.getText(file)) && ofVaultOps(node)) methods.set(node.name.getText(file), node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of wanted) if (!methods.has(name)) throw new Error(`vaultOps.${name} is gone from vaultService.ts — re-point this harness`);
  const code = ts.transpileModule(`const vaultOps = {${wanted.map((name) => methods.get(name)).join(",\n")}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  // What the four methods reach for. The daily note of this test exists, so
  // nothing behind "it was created" is ever asked for; and no editor holds a
  // pending save of it, so the flush before a change has nothing to land.
  const scope = {
    updateVaultText,
    noteSaver: { flush: async () => {} },
    getMobileSettings: () => SETTINGS,
    // The type a new daily note gets: the phone's one reader of the setting.
    configuredDailyNoteType,
    getActiveVaultEntry: async () => ({ name: "Notes" }),
    ensureSharedDailyNote: ensureDailyNote,
    applyTemplateInteractive: () => { throw new Error("a capture never asks the template's questions"); },
  };
  return new Function(...Object.keys(scope), `${code}\nreturn vaultOps;`)(...Object.values(scope)) as PhoneOps;
}

// The mark as the bytes a file starts with; the character itself is not typed into this file.
const MARK_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

const PATH = "Journal/2026-10-09.md";
const DAY = new Date(2026, 9, 9);

/** A daily note as a text of lines; `eol` joins them. */
const lines = (...text: string[]) => (eol: string) => [...text, ""].join(eol);
const HEAD = ["---", "type: Daily Note", "---", "# 2026-10-09", "", "## Journal", ""];
const TAIL = ["", "## Notes", "", "See [[Project#Plan]] and [[#Journal]]."];
const note = (...entries: string[]) => lines(...HEAD, ...entries, ...TAIL);

const START = note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third");
/**
 * What each step leaves behind, in the order the test takes them. A capture is
 * stamped with the clock — `at` is the time the first one got, `then` the
 * second one's; an entry goes to the end of the journal whatever its time is.
 */
const after = (at: string, then = at) => ({
  capture: note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third", `- ${at} on the train`),
  shared: note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda"),
  edit: note("- 09:15 first, reworded", "- [ ] 10:30 a task", "  continued", "- 12:00 third", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda"),
  toTask: note("- 09:15 first, reworded", "- [ ] 10:30 a task", "  continued", "- [ ] 12:00 third", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda"),
  tick: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", "- [ ] 12:00 third", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda"),
  remove: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda"),
  oops: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", "- [ ] 12:00 third", `- ${at} on the train`, "- 15:30 Agenda", "  https://example.test/agenda", `- [ ] ${then} oops`),
});

let db: IDatabaseAdapter, folder: Map<string, string | Uint8Array>, vault: MobileVault, autoMerged: string[];

beforeEach(async () => {
  phone.ops = phoneOps();
  db = await realSqlite();
  folder = new Map();
  autoMerged = [];
  // The chain `boot()` puts over the raw adapter of a picked folder.
  const adapter = new ExternalVaultAdapter(fakeVaultFolder(folder).plugin, "picked");
  const snapshots = new BackupVaultAdapter(adapter);
  const syncRepo = new SyncStateRepository(db, adapter, "device-a");
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(snapshots, new SyncQueue(db)), syncRepo, (path) => { autoMerged.push(path); }, syncRepo, "external-folder");
  vault = { vaultId: "vault-picked", adapter, files, backup: snapshots, db, indexer: null, reindexPaths: async () => {} } as unknown as MobileVault;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

/** The folder as the user's other programs left it: the daily note, and a first pass of the index over it. */
async function openFolder(daily: number[]) {
  folder.set(PATH, new Uint8Array(daily));
  folder.set("Project.md", "# Project\n\n## Plan\n");
  await new VaultIndexer(vault.files, db).indexVaultFull("open");
}

const entryAt = async (time: string) => {
  const entry = parseJournal(await ops().read(vault, PATH), { heading: journalHeading() }).entries.find((e) => e.time === time);
  if (!entry) throw new Error(`no entry at ${time}`);
  return { path: PATH, entry, heading: journalHeading() };
};

describe.each([{ name: "\\n", eol: "\n" }, { name: "\\r\\n", eol: "\r\n" }])("a daily note that starts with a byte order mark in a picked folder, line ends $name", ({ eol }) => {
  /** The file has to be: its mark, then this text in the note's line ends. */
  const marked = (text: (eol: string) => string) => [...MARK_BYTES, ...utf8(text(eol))];

  it("takes every change the journal makes, and each leaves the mark and every other byte where it was", async () => {
    await openFolder(marked(START));
    const said = vi.spyOn(toast, "success");
    const refused = vi.spyOn(toast, "error");

    // The capture sheet — from the Today screen, the launcher shortcut, the widget's order.
    const captured = await captureJournalEntry(vault, { text: "on the train", task: false, date: DAY });
    // Until 2026-10-09: null, a toast "this entry cannot be placed", and the file untouched.
    expect(captured).toMatchObject({ path: PATH, entry: { text: "on the train", task: null, line: 11 } });
    const AFTER = after(captured!.entry.time);
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.capture));

    // Something shared into the journal: planned first, written then — and found again by a retry.
    const planned = { date: "2026-10-09", time: "15:30", heading: journalHeading(), text: "Agenda\nhttps://example.test/agenda" };
    expect(await appendPlannedJournalEntry(vault, planned)).toBe(PATH);
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.shared));
    expect(await appendPlannedJournalEntry(vault, planned)).toBe(PATH);
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.shared));

    // The journal screen's own actions, through the files this shell hands them.
    const files = journalFiles(vault);
    expect(await editJournalEntry(files, await entryAt("09:15"), { text: "first, reworded" })).toMatchObject({ ok: true, entry: { text: "first, reworded" } });
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.edit));

    expect(await setJournalEntryTaskState(files, await entryAt("12:00"), "open")).toMatchObject({ ok: true, entry: { task: "open" } });
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.toTask));

    expect(await toggleJournalEntryTask(files, await entryAt("10:30"), { today: "2026-10-09" })).toMatchObject({ ok: true, entry: { task: "done" } });
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.tick));

    const removed = await deleteJournalEntry(files, await entryAt("12:00"));
    if (!removed.ok || !removed.undo) throw new Error("the entry was not removed");
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.remove));
    expect(await undoJournalChange(files, removed.undo, journalHeading())).toBe(true);
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.tick));

    // A task captured, and taken back with the "Undo" of its toast.
    said.mockClear();
    const oops = await captureJournalEntry(vault, { text: "oops", task: true, date: DAY });
    expect(oops).toMatchObject({ path: PATH, entry: { text: "oops", task: "open" } });
    expect(folderBytes(folder, PATH)).toEqual(marked(after(captured!.entry.time, oops!.entry.time).oops));
    const undo = said.mock.calls[0]?.[1];
    expect(undo?.label).toBe("common.undo");
    // The toast's action does not wait for the write; the service says "taken back" when it is through.
    const takenBack = vi.spyOn(toast, "info");
    undo!.run();
    await vi.waitFor(() => expect(takenBack).toHaveBeenCalledWith("journal.undone"), { timeout: 15_000, interval: 25 });
    expect(folderBytes(folder, PATH)).toEqual(marked(AFTER.tick));

    expect(refused).not.toHaveBeenCalled();
    // The app's own writes, and seen as such: no merge, no conflict copy.
    expect(autoMerged).toEqual([]);
    expect(await vault.files.listConflictSessions!()).toEqual([]);
    expect([...folder.keys()].filter((path) => path.includes(".CONFLICT"))).toEqual([]);
  });

  it("shows the note's entries, its outline and an embedded section as it shows those of the note without a mark", async () => {
    await openFolder(marked(after("14:05").tick));
    const text = await ops().read(vault, PATH);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const plain = text.slice(1);

    // The journal screen and the day's section on the Today screen.
    expect(parseJournal(text, { heading: journalHeading() }).entries.map((e) => [e.line, e.time, e.task, e.text])).toEqual([
      [7, "09:15", null, "first, reworded"], [8, "10:30", "done", "a task\ncontinued"], [10, "12:00", "open", "third"],
      [11, "14:05", null, "on the train"], [12, "15:30", null, "Agenda\nhttps://example.test/agenda"],
    ]);
    // The outline in the note's sheet: each heading in its own line. A tap used to lead one line above it.
    expect(parseHeadings(text).map((h) => [h.level, h.text, h.line])).toEqual([[1, "2026-10-09", 4], [2, "Journal", 6], [2, "Notes", 16]]);

    // The card of an embedded section (`![[2026-10-09#Notes]]`), as the editor host builds it.
    const card = async (raw: string) => {
      const fragment = selectNoteFragment(raw, "#Notes");
      if (fragment.status !== "found") throw new Error("the section was not found");
      const preview = await noteEmbedPreview(fragment.text, PATH, {
        resolve: async () => null,
        read: (path) => ops().read(vault, path),
        message: (kind, target) => `${kind}:${target}`,
      });
      return markdownToPlainText(preview);
    };
    expect(await card(text)).toBe(await card(plain));
    expect((await card(text)).startsWith("Notes")).toBe(true);
    // The card of the whole note: the file's text, shown without its mark and without its properties block.
    const whole = selectNoteFragment(text, null);
    if (whole.status !== "found") throw new Error("the note was not found");
    const shown = markdownToPlainText(await noteEmbedPreview(whole.text, PATH, { resolve: async () => null, read: (path) => ops().read(vault, path), message: (kind, target) => `${kind}:${target}` }));
    expect(shown.includes(String.fromCharCode(0xfeff))).toBe(false);
    expect(shown.trimStart().startsWith("2026-10-09")).toBe(true);
  });
});
