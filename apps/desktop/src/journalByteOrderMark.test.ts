import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  VaultQueryService,
  parseJournal,
  type IDatabaseAdapter,
} from "@plainva/core";
import {
  appendJournalEntry,
  appendPlannedJournalEntry,
  backlinkContexts,
  deleteJournalEntry,
  editJournalEntry,
  journalCandidates,
  journalDayOf,
  parseHeadings,
  resolveAnchor,
  setJournalEntryTaskState,
  toggleJournalEntryTask,
  undoJournalChange,
  type JournalFiles,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { sourceFile } from "./test-sourceTree";

/**
 * The journal and a daily note that starts with a byte order mark
 * (finding 2026-10-09).
 *
 * A file's text is its bytes decoded with the mark, so a daily note that
 * another program wrote with one reaches the journal with it. Until then the
 * journal answered "this entry cannot be placed" for every such note and read
 * no entry in it: capturing failed, and what the note held appeared in no
 * journal view. Nothing was written and nothing was damaged — the places of
 * the note's blocks came from a parse that counts from behind the mark and
 * were laid on the text with it (`parseMarkdownTree`, `parseSection`).
 *
 * The pure functions are held in the core (`journal.test.ts`,
 * `noteSource.test.ts`, `markdown-places.test.ts`). Here the whole way runs:
 * real files, the adapter chain the app puts over them, the shared write
 * path, the index. What is asserted are the bytes on disk — the mark, and
 * behind it exactly what the same step leaves in the note without one.
 */

// Built at run time: the character is not typed into this file.
const MARK = String.fromCharCode(0xfeff);
const MARK_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

const PATH = "Journal/2026-10-09.md";
const HEADING = "Journal";
const DAY = new Date(2026, 9, 9);

/** A daily note as a text of lines; `eol` joins them. */
const lines = (...text: string[]) => (eol: string) => [...text, ""].join(eol);
const HEAD = ["---", "type: Daily Note", "---", "# 2026-10-09", "", "## Journal", ""];
const TAIL = ["", "## Notes", "", "See [[Project#Plan]] and [[#Journal]]."];
const note = (...entries: string[]) => lines(...HEAD, ...entries, ...TAIL);

const START = note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third");
/** What each step leaves behind, in the order the test takes them. */
const AFTER = {
  capture: note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third", "- 14:05 on the train"),
  shared: note("- 09:15 first", "- [ ] 10:30 a task", "  continued", "- 12:00 third", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda"),
  edit: note("- 09:15 first, reworded", "- [ ] 10:30 a task", "  continued", "- 12:00 third", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda"),
  toTask: note("- 09:15 first, reworded", "- [ ] 10:30 a task", "  continued", "- [ ] 12:00 third", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda"),
  tick: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", "- [ ] 12:00 third", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda"),
  remove: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda"),
  oops: note("- 09:15 first, reworded", "- [x] 10:30 a task", "  continued", "- [ ] 12:00 third", "- 14:05 on the train", "- 15:30 Agenda", "  https://example.test/agenda", "- 16:00 oops"),
};

interface Desk {
  root: string;
  db: IDatabaseAdapter;
  vault: ConflictAwareVaultAdapter;
  query: VaultQueryService;
  files: JournalFiles;
  autoMerged: string[];
}

const desks: Desk[] = [];
afterEach(async () => {
  for (const made of desks.splice(0)) {
    await made.db.close();
    await rm(made.root, { recursive: true, force: true });
  }
});

/**
 * A vault as the desktop opens it: real files, and over them the chain every
 * write of the app goes through (VaultContext) — snapshots, the sync queue,
 * the check against what the index last saw. `files` is what `useJournalFiles`
 * hands the shared write path: read and write through that chain, and the
 * index told about the write.
 */
async function desk(daily: string): Promise<Desk> {
  const root = await mkdtemp(join(tmpdir(), "plainva-journal-mark-"));
  const disk = new LocalVaultAdapter(root);
  await disk.initialize();
  const db = await realSqlite();
  const backup = new BackupVaultAdapter(disk);
  const repo = new SyncStateRepository(db, backup, "device-a");
  const autoMerged: string[] = [];
  const vault = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, (path) => { autoMerged.push(path); }, repo, "external-folder");
  await disk.createDir("Journal");
  await disk.writeTextFile(PATH, daily);
  await disk.writeTextFile("Project.md", "# Project\n\n## Plan\n\nBegun on [[Journal/2026-10-09#Journal]].\n");
  const indexer = new VaultIndexer(vault, db);
  await indexer.indexVaultFull("open");
  const files: JournalFiles = {
    ensureDailyNote: async () => ({ path: PATH, created: false }),
    readTextFile: (path) => vault.readTextFile(path),
    writeTextFile: async (path, content) => {
      await vault.writeTextFile(path, content);
      await indexer.indexPath(path);
    },
  };
  const made = { root, db, vault, query: new VaultQueryService(db), files, autoMerged };
  desks.push(made);
  return made;
}

const bytes = async (at: Desk) => [...await readFile(join(at.root, PATH))];
const entryAt = async (at: Desk, time: string) => {
  const entry = parseJournal(await at.vault.readTextFile(PATH), { heading: HEADING }).entries.find((e) => e.time === time);
  if (!entry) throw new Error(`no entry at ${time}`);
  return { path: PATH, entry, heading: HEADING };
};

describe.each([{ name: "\\n", eol: "\n" }, { name: "\\r\\n", eol: "\r\n" }])("a daily note that starts with a byte order mark, line ends $name", ({ eol }) => {
  /** The file has to be: its mark, then this text in the note's line ends. */
  const marked = (text: (eol: string) => string) => [...MARK_BYTES, ...utf8(text(eol))];

  it("takes every change the journal makes, and each leaves the mark and every other byte where it was", async () => {
    const at = await desk(MARK + START(eol));
    expect(await bytes(at)).toEqual(marked(START));

    // A thought captured from outside the journal view: the quick capture, the tray, the ribbon.
    const captured = await appendJournalEntry(at.files, { date: DAY, text: "on the train", heading: HEADING, now: new Date(2026, 9, 9, 14, 5, 30) });
    // Until 2026-10-09: { ok: false, reason: "unplaceable" }, and the file untouched.
    expect(captured).toMatchObject({ ok: true, path: PATH, createdNote: false, entry: { time: "14:05", text: "on the train", line: 11 } });
    expect(await bytes(at)).toEqual(marked(AFTER.capture));

    // Something shared into the journal: planned first, written then — and found again by a retry.
    const planned = { date: "2026-10-09", time: "15:30", heading: HEADING, text: "Agenda\nhttps://example.test/agenda" };
    expect(await appendPlannedJournalEntry(at.files, planned)).toBe(PATH);
    expect(await bytes(at)).toEqual(marked(AFTER.shared));
    // The retry reads the note's entries to find its own. It read none, and would have written the entry again.
    expect(await appendPlannedJournalEntry(at.files, planned)).toBe(PATH);
    expect(await bytes(at)).toEqual(marked(AFTER.shared));

    expect(await editJournalEntry(at.files, await entryAt(at, "09:15"), { text: "first, reworded" })).toMatchObject({ ok: true, entry: { text: "first, reworded" } });
    expect(await bytes(at)).toEqual(marked(AFTER.edit));

    expect(await setJournalEntryTaskState(at.files, await entryAt(at, "12:00"), "open")).toMatchObject({ ok: true, entry: { task: "open" } });
    expect(await bytes(at)).toEqual(marked(AFTER.toTask));

    expect(await toggleJournalEntryTask(at.files, await entryAt(at, "10:30"), { today: "2026-10-09" })).toMatchObject({ ok: true, entry: { task: "done", text: "a task\ncontinued" } });
    expect(await bytes(at)).toEqual(marked(AFTER.tick));

    const removed = await deleteJournalEntry(at.files, await entryAt(at, "12:00"));
    if (!removed.ok || !removed.undo) throw new Error("the entry was not removed");
    expect(await bytes(at)).toEqual(marked(AFTER.remove));
    // Taken back while nothing else touched the note: byte for byte what it was.
    expect(await undoJournalChange(at.files, removed.undo, HEADING)).toBe(true);
    expect(await bytes(at)).toEqual(marked(AFTER.tick));

    const oops = await appendJournalEntry(at.files, { date: DAY, text: "oops", heading: HEADING, now: new Date(2026, 9, 9, 16, 0) });
    if (!oops.ok || !oops.undo) throw new Error("the entry was not captured");
    expect(await bytes(at)).toEqual(marked(AFTER.oops));
    expect(await undoJournalChange(at.files, oops.undo, HEADING)).toBe(true);
    expect(await bytes(at)).toEqual(marked(AFTER.tick));

    // The app's own writes, and seen as such: no merge, no conflict copy.
    expect(at.autoMerged).toEqual([]);
    expect(await at.vault.listConflictSessions()).toEqual([]);
  });

  it("takes back a capture by the entry's spelling once the note has been written since", async () => {
    const at = await desk(MARK + START(eol));
    const captured = await appendJournalEntry(at.files, { date: DAY, text: "on the train", heading: HEADING, now: new Date(2026, 9, 9, 14, 5, 30) });
    if (!captured.ok || !captured.undo) throw new Error("the entry was not captured");
    // The open editor saved a sentence in between: the note is no longer what the capture left.
    const since = MARK + AFTER.capture(eol).replace("See [[Project#Plan]]", `Typed since.${eol}${eol}See [[Project#Plan]]`);
    await at.files.writeTextFile(PATH, since);
    // The entry is looked up in the note as it is now — by its line and its
    // spelling, both read behind the mark — and only it goes.
    expect(await undoJournalChange(at.files, captured.undo, HEADING)).toBe(true);
    expect(await bytes(at)).toEqual([...MARK_BYTES, ...utf8(since.slice(1).replace(`- 14:05 on the train${eol}`, ""))]);
  });

  it("shows the note's entries, headings and places as it shows those of the note without a mark", async () => {
    const plain = await desk(AFTER.tick(eol));
    const read = await desk(MARK + AFTER.tick(eol));
    const view = async (at: Desk) => {
      const text = await at.vault.readTextFile(PATH);
      const [candidate] = journalCandidates([PATH], { folder: "Journal", format: "YYYY-MM-DD" });
      const links = await at.db.query<{ target_raw: string; anchor: string | null; line_number: number }>(
        "SELECT l.target_raw, l.anchor, l.line_number FROM links l JOIN files f ON f.id = l.source_id WHERE f.path = ? ORDER BY l.line_number, l.target_raw", [PATH]);
      const backlinks = (await at.query.getBacklinks("Project.md")).filter((row) => row.source_path === PATH);
      const hit = (await at.query.searchOccurrencesPage("train")).hits.find((row) => row.path === PATH);
      return {
        // The journal view and the day's section in the sidebar.
        entries: journalDayOf(candidate, text, HEADING)?.entries.map((e) => [e.line, e.time, e.task, e.text]),
        // The outline, and where an anchor link leads.
        headings: parseHeadings(text).map((h) => [h.level, h.text, h.line, h.slug]),
        anchors: ["#Journal", "#Notes", "#notes"].map((anchor) => resolveAnchor(text, anchor)),
        // The index: each link with its anchor and its line.
        links,
        // The backlinks panel: under which headings a link stands.
        places: backlinkContexts(text, backlinks.map((row) => row.line_number ?? 0)).map((place) => [place.line, place.headings, place.lineText]),
        // The search: a hit with its line, the headings above it, and the passage it addresses in the file.
        hit: hit?.occurrence ? { line: hit.occurrence.line, headings: hit.occurrence.headings, addressed: text.slice(hit.occurrence.from, hit.occurrence.to) } : null,
      };
    };
    const shown = await view(read);
    expect(shown.entries).toEqual([
      [7, "09:15", null, "first, reworded"], [8, "10:30", "done", "a task\ncontinued"], [10, "12:00", "open", "third"],
      [11, "14:05", null, "on the train"], [12, "15:30", null, "Agenda\nhttps://example.test/agenda"],
    ]);
    // Each heading in its own line. They used to be named one line higher: the outline led above the heading.
    expect(shown.headings).toEqual([[1, "2026-10-09", 4, "2026-10-09"], [2, "Journal", 6, "journal"], [2, "Notes", 16, "notes"]]);
    expect(shown.anchors).toEqual([{ line: 6, slug: "journal", kind: "heading" }, { line: 16, slug: "notes", kind: "heading" }, { line: 16, slug: "notes", kind: "heading" }]);
    expect(shown.links).toEqual([
      { target_raw: "https://example.test/agenda", anchor: null, line_number: 14 },
      { target_raw: "#Journal", anchor: "#Journal", line_number: 18 },
      { target_raw: "Project#Plan", anchor: "#Plan", line_number: 18 },
    ]);
    expect(shown.places).toEqual([[18, ["2026-10-09", "Notes"], "See [[Project#Plan]] and [[#Journal]]."]]);
    expect(shown.hit).toEqual({ line: 12, headings: ["2026-10-09", "Journal"], addressed: "train" });
    expect(shown).toEqual(await view(plain));
  });
});

describe("the place of a link in a note that starts with a byte order mark", () => {
  it("names a list item in the first line without its marker, and a heading not as its own parent", () => {
    // The mark stands in front of the first line and is no part of it.
    expect(backlinkContexts(`${MARK}- first item with [[Alpha]]\n`, [1])).toEqual([{ line: 1, headings: [], listParents: [], lineText: "first item with [[Alpha]]" }]);
    // A link ON a heading line has that heading as its line text, not above it —
    // with every heading named one line higher, it stood above itself.
    const text = `${MARK}# Top\n\n## Section with [[Alpha]]\n\n- parent\n  - child with [[Alpha]]\n`;
    expect(backlinkContexts(text, [3, 6])).toEqual([
      { line: 3, headings: ["Top"], listParents: [], lineText: "## Section with [[Alpha]]" },
      { line: 6, headings: ["Top", "Section with [[Alpha]]"], listParents: ["parent"], lineText: "child with [[Alpha]]" },
    ]);
    expect(backlinkContexts(text, [3, 6])).toEqual(backlinkContexts(text.slice(1), [3, 6]));
  });
});

describe("where the journal gets a daily note's text", () => {
  it("both shells hand the shared write path the file's text as their vault reads it, and write what comes back", () => {
    // Nothing between the file and the journal decodes or reshapes: the text
    // keeps its mark and its line ends on the way in, and the journal's result
    // goes to the file as it is. A shell that held the note differently here
    // would be a second text for one file.
    const desktop = sourceFile("apps/desktop/src/hooks/useJournal.ts");
    expect(desktop).toContain("readTextFile: (path) => vaultAdapter.readTextFile(path),");
    expect(desktop).toMatch(/writeTextFile: async \(path, content\) => \{\s+await vaultAdapter\.writeTextFile\(path, content\);/);
    const phone = sourceFile("apps/mobile/src/services/journalService.ts");
    expect(phone).toContain("readTextFile: (path) => vaultOps.read(vault, path),");
    expect(phone).toMatch(/writeTextFile: async \(path, content\) => \{\s+await vaultOps\.save\(vault, path, content\);/);
    // A change of a daily note that exists goes through the vault's entry: the
    // chain reads the file itself and hands the journal that same text.
    expect(desktop).toMatch(/updateTextFile: async \(path, change\) => \{\s+const update = await updateVaultText\(vaultAdapter, path, change\);/);
    expect(phone).toMatch(/updateTextFile: async \(path, change\) => \{\s+const update = await vaultOps\.update\(vault, path, change\);/);
  });
});
