import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDraftJournal,
  createDraftWriter,
  draftIntervalFor,
  decodeDraftJournal,
  encodeDraftJournal,
  type DraftJournalEntry,
  type DraftJournalLayout,
  type DraftJournalStorage,
} from "@plainva/ui";

/**
 * The draft journal both shells wire (stability plan R6): the rules, against a
 * storage held in memory. Each shell's own test (`services/draftJournal.test.ts`
 * there) holds where its files lie and how they are written.
 */

class MemoryDrafts implements DraftJournalStorage {
  readonly files = new Map<string, { text: string; mtimeMs: number }>();
  readonly unreadable = new Set<string>();
  writes = 0;
  reads = 0;
  /** Files whose next write fails once. */
  readonly failOnce = new Set<string>();
  /** Holds every write until it is opened. */
  gate: Promise<void> | null = null;
  constructor(private readonly now: () => number) {}
  async read(file: string) {
    this.reads += 1;
    if (this.unreadable.has(file)) throw new Error("I/O error");
    return this.files.get(file)?.text ?? null;
  }
  /** Files whose write never settles (a native call that never answers). */
  readonly hanging = new Set<string>();
  async write(file: string, text: string) {
    if (this.hanging.has(file)) return new Promise<void>(() => {});
    if (this.failOnce.delete(file)) throw new Error("disk full");
    if (this.gate) await this.gate;
    this.writes += 1; this.files.set(file, { text, mtimeMs: this.now() });
  }
  async remove(file: string) { this.files.delete(file); }
  async list(dir: string) {
    return [...this.files].filter(([file]) => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes("/"))
      .map(([file, { mtimeMs }]) => ({ name: file.slice(dir.length + 1), isFile: true, mtimeMs }));
  }
  entries(file: string): DraftJournalEntry[] {
    const held = this.files.get(file);
    return held ? decodeDraftJournal(held.text) : [];
  }
}

const VAULT = "V";
const layout: DraftJournalLayout<string> = {
  key: (vault) => vault,
  file: (vault, note) => `${vault}/${note.replace(/\//g, "_")}.json`,
  dirs: (vault) => [vault],
  fileIn: (dir, name) => `${dir}/${name}`,
  owner: (vault, notePath) => ({ vaultPath: vault, notePath }),
  ours: (vault, entry) => entry.vaultPath === undefined || entry.vaultPath === vault,
};

let clock = 1_000_000;
const now = () => clock;
let storage: MemoryDrafts;
const journalOf = (runStartedAt = clock) => createDraftJournal<string>({ storage, layout, now, runStartedAt });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  clock = 1_000_000;
  storage = new MemoryDrafts(now);
});
afterEach(() => { vi.useRealTimers(); });

/** Let every queued lane and timer step run. */
async function settle(ms = 0) {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  }
}

describe("the shared draft writer", () => {
  it("keeps continuous typing: a crash loses at most the throttle window, also when the typing never pauses", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    let text = "";
    // Five seconds of typing, a key every 50 ms — never a pause of 400 ms.
    for (let i = 0; i < 100; i++) {
      text += "x";
      const at = text;
      writer.write(VAULT, "Note.md", () => at, i + 1, "editor-1");
      clock += 50;
      await vi.advanceTimersByTimeAsync(50);
    }
    // The app goes now: what is on disk is what a crash leaves.
    const [entry] = storage.entries(layout.file(VAULT, "Note.md"));
    expect(entry.sessionId).toBe("editor-1");
    // At most 400 ms (eight keys) behind the buffer.
    expect(entry.text.length).toBeGreaterThanOrEqual(100 - 8);
    // …and not one write per key.
    expect(storage.writes).toBeLessThanOrEqual(15);
  });

  it("a save that covered the buffered revision takes it back; typing during the save survives it", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    writer.write(VAULT, "Note.md", "one", 1, "editor-1");
    await settle();
    clock += 100;
    writer.write(VAULT, "Note.md", "one two", 2, "editor-1");
    // The save of revision 1 confirms while revision 2 is still buffered.
    await writer.clear(VAULT, "Note.md", 1, "editor-1");
    await settle(500);
    expect(storage.entries(layout.file(VAULT, "Note.md")).map((e) => [e.text, e.revision])).toEqual([["one two", 2]]);
    // The save of revision 2 then clears it.
    await writer.clear(VAULT, "Note.md", 2, "editor-1");
    expect(storage.files.has(layout.file(VAULT, "Note.md"))).toBe(false);
  });

  it("a save of a revision that was only buffered is never journaled after the save", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    writer.write(VAULT, "Note.md", "first", 1, "editor-1");
    await settle();
    clock += 100;
    writer.write(VAULT, "Note.md", "second", 2, "editor-1");
    await writer.clear(VAULT, "Note.md", 2, "editor-1");
    await settle(1000);
    expect(storage.files.has(layout.file(VAULT, "Note.md"))).toBe(false);
  });

  it("two editors on one note (a split) keep a snapshot each", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    writer.write(VAULT, "Note.md", "left", 1, "pane-a");
    writer.write(VAULT, "Note.md", "right", 1, "pane-b");
    await settle(500);
    expect(storage.entries(layout.file(VAULT, "Note.md")).map((e) => `${e.sessionId}:${e.text}`).sort()).toEqual(["pane-a:left", "pane-b:right"]);
  });

  it("a failed snapshot keeps its buffer and is tried again", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    const file = layout.file(VAULT, "Note.md");
    storage.unreadable.add(file);
    writer.write(VAULT, "Note.md", "kept", 1, "editor-1");
    await settle();
    expect(storage.files.has(file)).toBe(false);
    expect(writer.isPending(file)).toBe(true);
    storage.unreadable.delete(file);
    await settle(2500);
    expect(storage.entries(file).map((e) => e.text)).toEqual(["kept"]);
  });
});

describe("the shared draft journal", () => {
  it("never writes over a file it cannot read", async () => {
    const journal = journalOf();
    const file = layout.file(VAULT, "Note.md");
    storage.files.set(file, { text: encodeDraftJournal([{ vaultPath: VAULT, notePath: "Note.md", text: "older", revision: 3, savedAt: 1, sessionId: "old" }]), mtimeMs: 1 });
    storage.unreadable.add(file);
    await expect(journal.record(VAULT, "Note.md", "new", 1, "editor-1")).rejects.toThrow("I/O error");
    storage.unreadable.delete(file);
    expect(storage.entries(file).map((e) => e.text)).toEqual(["older"]);
  });

  it("the app killed between the draft and the file: the next run offers the draft, once, and as a leftover", async () => {
    await journalOf().record(VAULT, "Note.md", "typed, never saved", 7, "editor-1");
    // The next run of the app: a new journal, later.
    clock += 60_000;
    const next = journalOf(clock);
    expect((await next.read(VAULT, "Note.md", "on disk"))?.text).toBe("typed, never saved");
    expect(await next.read(VAULT, "Note.md", "typed, never saved")).toBeNull();
    const leftovers = await next.takeLeftovers(VAULT, "Note.md");
    expect(leftovers.map((e) => e.text)).toEqual(["typed, never saved"]);
    expect(await next.takeLeftovers(VAULT, "Note.md")).toEqual([]);
    next.releaseLeftovers(VAULT, "Note.md", leftovers);
    expect((await next.takeLeftovers(VAULT, "Note.md")).map((e) => e.text)).toEqual(["typed, never saved"]);
  });

  it("an offered draft of the editor's own session is lifted out of its reach until it is adopted (3.125)", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    await journal.record(VAULT, "Note.md", "unsaved", 2, "run");
    const offer = await journal.offer(VAULT, "Note.md", "disk", "run");
    expect(offer?.text).toBe("unsaved");
    expect(offer?.sessionId).not.toBe("run");
    // Typing on and the save of it do not take the offer with them.
    writer.write(VAULT, "Note.md", "typing on", 3, "run");
    await writer.clear(VAULT, "Note.md", 3, "run");
    expect((await journal.read(VAULT, "Note.md", "typing on"))?.text).toBe("unsaved");
    // Restored: the restored text's own snapshot is written first, then the offer goes.
    writer.write(VAULT, "Note.md", "unsaved", 4, "run");
    await writer.adopt(VAULT, "Note.md", { savedAt: offer!.savedAt, revision: offer!.revision, sessionId: offer!.sessionId }, "run");
    expect(storage.entries(layout.file(VAULT, "Note.md")).map((e) => `${e.sessionId}:${e.text}`)).toEqual(["run:unsaved"]);
  });

  it("an adopt without the editor's own entry keeps the offer: a later open offers it again", async () => {
    const journal = journalOf();
    await journal.record(VAULT, "Note.md", "unsaved", 2, "earlier-run");
    const offer = await journal.offer(VAULT, "Note.md", "disk", "run");
    await journal.adopt(VAULT, "Note.md", { savedAt: offer!.savedAt, revision: offer!.revision, sessionId: offer!.sessionId }, "run");
    expect((await journal.read(VAULT, "Note.md", "disk"))?.text).toBe("unsaved");
  });

  it("clearIf takes exactly that draft and leaves a newer one of the same session", async () => {
    const journal = journalOf();
    await journal.record(VAULT, "Note.md", "a", 1, "s");
    const first = (await journal.read(VAULT, "Note.md"))!;
    clock += 10;
    await journal.record(VAULT, "Note.md", "b", 2, "s");
    await journal.clearIf(VAULT, "Note.md", { savedAt: first.savedAt, revision: first.revision, sessionId: "s" });
    expect(storage.entries(layout.file(VAULT, "Note.md")).map((e) => e.text)).toEqual(["b"]);
  });

  it("entries follow a move entry by entry; a file shared with another note keeps that note's", async () => {
    const journal = journalOf();
    const shared = layout.file(VAULT, "Old.md");
    storage.files.set(shared, {
      text: encodeDraftJournal([
        { vaultPath: VAULT, notePath: "Old.md", text: "mine", revision: 1, savedAt: clock, sessionId: "s" },
        { vaultPath: VAULT, notePath: "Other.md", text: "theirs", revision: 1, savedAt: clock, sessionId: "t" },
        { vaultPath: "Another vault", notePath: "Old.md", text: "not this vault", revision: 1, savedAt: clock, sessionId: "u" },
      ]),
      mtimeMs: clock,
    });
    await journal.relocate(VAULT, [{ from: "Old.md", to: "Folder/New.md" }]);
    expect(storage.entries(layout.file(VAULT, "Folder/New.md")).map((e) => `${e.notePath}:${e.text}`)).toEqual(["Folder/New.md:mine"]);
    expect(storage.entries(shared).map((e) => e.text).sort()).toEqual(["not this vault", "theirs"]);
  });

  it("pruning leaves a file with a young entry, one with a snapshot pending, and one it cannot read", async () => {
    const journal = journalOf();
    const old = clock - 8 * 24 * 60 * 60 * 1000;
    const put = (note: string, savedAt: number) => storage.files.set(layout.file(VAULT, note), {
      text: encodeDraftJournal([{ vaultPath: VAULT, notePath: note, text: note, revision: 1, savedAt, sessionId: "s" }]), mtimeMs: old,
    });
    put("Stale.md", old);
    put("Young.md", clock);
    put("Pending.md", old);
    put("Locked.md", old);
    storage.unreadable.add(layout.file(VAULT, "Locked.md"));
    await journal.prune(VAULT, (file) => file === layout.file(VAULT, "Pending.md"));
    expect([...storage.files.keys()].sort()).toEqual([layout.file(VAULT, "Locked.md"), layout.file(VAULT, "Pending.md"), layout.file(VAULT, "Young.md")].sort());
  });
});

describe("review of 2026-11-11", () => {
  it("M1: a snapshot whose getter no longer holds its note is dropped, never written under that note's name", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    let shows: "A.md" | "B.md" = "A.md";
    const text = { "A.md": "A typed", "B.md": "B: a completely different note" };
    const bound = (note: "A.md" | "B.md") => () => (shows === note ? text[shows] : null);
    writer.write(VAULT, "A.md", bound("A.md"), 1, "pane");
    await settle();
    clock += 100;
    text["A.md"] = "A typed more";
    writer.write(VAULT, "A.md", bound("A.md"), 2, "pane");
    // The pane opens B before the buffered snapshot of A is written.
    shows = "B.md";
    await settle(500);
    expect(storage.entries(layout.file(VAULT, "A.md")).map((e) => e.text)).toEqual(["A typed"]);
    expect(writer.isPending(layout.file(VAULT, "A.md"))).toBe(false);
  });

  it("M2: a draft that follows a move onto a path with an entry of the same session never gives way to a revision of another note", async () => {
    const journal = journalOf();
    // Earlier in the run: B at revision 30 of B's counter, never confirmed.
    await journal.record(VAULT, "B.md", "OLD TEXT OF B", 30, "run");
    clock += 4000;
    // Now: A's unsaved typing at revision 3 of A's counter, newer in time.
    await journal.record(VAULT, "A.md", "UNSAVED TEXT OF A", 3, "run");
    await journal.relocate(VAULT, [{ from: "A.md", to: "B.md" }]);
    const atB = storage.entries(layout.file(VAULT, "B.md"));
    expect(atB.map((e) => e.text).sort()).toEqual(["OLD TEXT OF B", "UNSAVED TEXT OF A"]);
    expect(atB.every((e) => e.notePath === "B.md")).toBe(true);
    expect(storage.files.has(layout.file(VAULT, "A.md"))).toBe(false);
    // What is offered is the newer by time.
    expect((await journal.read(VAULT, "B.md", "what B.md holds"))?.text).toBe("UNSAVED TEXT OF A");
    // The session's next save at B clears both.
    await journal.clear(VAULT, "B.md", 31, "run");
    expect(storage.files.has(layout.file(VAULT, "B.md"))).toBe(false);
  });

  it("entries of different sessions meeting at a destination both stay (as before the rework: withDraftEntry never touched another session)", async () => {
    const journal = journalOf();
    await journal.record(VAULT, "B.md", "B in pane one", 5, "pane-1");
    clock += 10;
    await journal.record(VAULT, "A.md", "A in pane two", 1, "pane-2");
    await journal.relocate(VAULT, [{ from: "A.md", to: "B.md" }]);
    expect(storage.entries(layout.file(VAULT, "B.md")).map((e) => `${e.sessionId}:${e.text}`).sort()).toEqual(["pane-1:B in pane one", "pane-2:A in pane two"]);
  });

  it("a move that ended between writing the destination and clearing the source is not doubled by the next move", async () => {
    const journal = journalOf();
    // The entry was written to B already, and the app ended before A's file lost it.
    const entry = { vaultPath: VAULT, notePath: "A.md", text: "text", revision: 1, savedAt: clock, sessionId: "s" };
    storage.files.set(layout.file(VAULT, "A.md"), { text: encodeDraftJournal([entry]), mtimeMs: clock });
    storage.files.set(layout.file(VAULT, "B.md"), { text: encodeDraftJournal([{ ...entry, notePath: "B.md" }]), mtimeMs: clock });
    await journal.relocate(VAULT, [{ from: "A.md", to: "B.md" }]);
    expect(storage.entries(layout.file(VAULT, "B.md")).map((e) => e.text)).toEqual(["text"]);
    expect(storage.files.has(layout.file(VAULT, "A.md"))).toBe(false);
  });

  it("a move does not hang on a snapshot of a moved note whose write never settles; it goes on after its bound (review 2026-11-12)", async () => {
    const journal = createDraftJournal<string>({ storage, layout, now, runStartedAt: clock, moveWaitMs: 2_000 });
    storage.hanging.add(layout.file(VAULT, "A.md"));
    void journal.record(VAULT, "A.md", "never lands", 1, "s");
    let moved = false;
    void journal.relocate(VAULT, [{ from: "A.md", to: "B.md" }]).then(() => { moved = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(moved).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(moved).toBe(true);
  });

  it("a move waits for no snapshot of another note or another vault (review 2026-11-12)", async () => {
    const journal = createDraftJournal<string>({ storage, layout, now, runStartedAt: clock, moveWaitMs: 60_000 });
    await journal.record(VAULT, "A.md", "unsaved A", 1, "s");
    storage.hanging.add(layout.file(VAULT, "Other.md"));
    storage.hanging.add(layout.file("Another vault", "A.md"));
    void journal.record(VAULT, "Other.md", "never lands", 1, "s");
    void journal.record("Another vault", "A.md", "never lands either", 1, "s");
    let moved = false;
    void journal.relocate(VAULT, [{ from: "A.md", to: "B.md" }]).then(() => { moved = true; });
    // No timer runs: the move does not wait at all.
    for (let i = 0; i < 20 && !moved; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(moved).toBe(true);
    expect(storage.entries(layout.file(VAULT, "B.md")).map((e) => e.text)).toEqual(["unsaved A"]);
  });

  it("clearing: a confirmation leaves the entry on disk while a newer snapshot of the session is buffered, and that snapshot replaces it", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    const file = layout.file(VAULT, "Note.md");
    writer.write(VAULT, "Note.md", "saved text", 1, "s");
    await settle();
    clock += 100;
    writer.write(VAULT, "Note.md", "typed during the save", 2, "s");
    await writer.clear(VAULT, "Note.md", 1, "s");
    // The confirmed entry stays until the newer one replaces it: a crash in between finds a text.
    expect(storage.entries(file).map((e) => e.text)).toEqual(["saved text"]);
    clock += 400;
    await settle(500);
    expect(storage.entries(file).map((e) => e.text)).toEqual(["typed during the save"]);
  });

  it("a large note is snapshotted less often: the interval grows with its size", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout);
    const big = "x".repeat(2_500_000);
    writer.write(VAULT, "Big.md", big, 1, "s");
    await settle();
    const writes = storage.writes;
    clock += 500;
    writer.write(VAULT, "Big.md", `${big}y`, 2, "s");
    // 2.5 MB: 5 s between snapshots, not 400 ms.
    await vi.advanceTimersByTimeAsync(4_400);
    expect(storage.writes).toBe(writes);
    clock += 5_100;
    await vi.advanceTimersByTimeAsync(700);
    await settle();
    expect(storage.writes).toBe(writes + 1);
  });
});

describe("the journal's pace and its reads (maintainer 17.11., release 0.9.0)", () => {
  it("the interval is set by the note's size, and it is the most text a crash can take", () => {
    expect([1, 100_000, 100_001, 1_000_000, 1_000_001, 5_000_000, 5_000_001].map(draftIntervalFor)).toEqual([400, 400, 2_000, 2_000, 5_000, 5_000, 10_000]);
  });

  for (const [size, interval] of [[50_000, 400], [500_000, 2_000], [3_000_000, 5_000], [6_000_000, 10_000]] as const) {
    it(`continuous typing in a note of ${size / 1000} KB is snapshotted every ${interval / 1000} s`, async () => {
      const writer = createDraftWriter(journalOf(), layout, { now });
      const text = "x".repeat(size);
      const at: number[] = [];
      let seen = 0;
      // A key every 100 ms for three intervals.
      for (let ms = 0, rev = 1; ms <= interval * 3; ms += 100, rev++) {
        writer.write(VAULT, "Note.md", `${text}${rev}`, rev, "s");
        await vi.advanceTimersByTimeAsync(0);
        if (storage.writes > seen) { seen = storage.writes; at.push(ms); }
        clock += 100;
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(at.slice(0, 4)).toEqual([0, interval, interval * 2, interval * 3]);
    });
  }

  it("typing on does not read the file back before each snapshot", async () => {
    const writer = createDraftWriter(journalOf(), layout, { now });
    for (let rev = 1; rev <= 20; rev++) {
      writer.write(VAULT, "Note.md", `text ${rev}`, rev, "s");
      clock += 400;
      await settle(400);
    }
    expect(storage.writes).toBe(20);
    // Once, for a file this journal has not written yet.
    expect(storage.reads).toBe(1);
  });

  it("two sessions on one file keep each other's entry without reading it back", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout, { now });
    const file = layout.file(VAULT, "Note.md");
    for (let rev = 1; rev <= 5; rev++) {
      writer.write(VAULT, "Note.md", `left ${rev}`, rev, "split-left");
      writer.write(VAULT, "Note.md", `right ${rev}`, rev, "split-right");
      // A third editor in another window: its snapshot comes to this journal over the bus (`draft-record`).
      await journal.record(VAULT, "Note.md", `window ${rev}`, rev, "aux-window");
      clock += 400;
      await settle(400);
    }
    expect(storage.entries(file).map((e) => `${e.sessionId}:${e.text}`).sort()).toEqual(["aux-window:window 5", "split-left:left 5", "split-right:right 5"]);
    // The editors' ten snapshots read once, the first, of a file this journal had not written yet;
    // each record from the other window reads, as a single record always did.
    expect(storage.reads).toBe(1 + 5);
    // The left editor's save confirmed: only its entry goes (a clear still reads the disk).
    await writer.clear(VAULT, "Note.md", 5, "split-left");
    expect(storage.entries(file).map((e) => e.sessionId).sort()).toEqual(["aux-window", "split-right"]);
  });

  it("drafts removed past the journal stay gone: forgetting app data and closing the vault clear its picture (review 17.11.)", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout, { now });
    const file = layout.file(VAULT, "Note.md");
    await journal.record(VAULT, "Note.md", "older draft of another session", 1, "OLD");
    writer.write(VAULT, "Note.md", "typing 1", 1, "S");
    await settle();
    // "Forget app data" removes the files past the journal, which is told.
    storage.files.clear();
    journal.forgetSeen(VAULT);
    clock += 400;
    writer.write(VAULT, "Note.md", "typing 2", 2, "S");
    await settle(400);
    expect(storage.entries(file).map((e) => `${e.sessionId}:${e.text}`)).toEqual(["S:typing 2"]);
    // Both shells tell it: the removal of a vault's drafts and the vault closing.
    const read = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", rel), "utf8");
    expect(read("apps/desktop/src/services/draftJournal.ts")).toMatch(/export async function removeVaultDrafts\(vaultPath: string\): Promise<void> \{[\s\S]{0,200}forgetDraftMemory\(vaultPath\);/);
    expect(read("apps/desktop/src/services/closeRuntime.ts")).toMatch(/await deps\.flushDrafts\(path\)[\s\S]{0,300}deps\.forgetDraftMemory\(path\);/);
    expect(read("apps/mobile/src/services/vaultForget.ts")).toMatch(/forgetDraftMemory\(vaultId\);\s*const drafts = removeInternalFolder/);
    expect(read("apps/mobile/src/services/vaultService.ts")).toMatch(/dispose: async \(\) => \{[\s\S]{0,300}forgetDraftMemory\(entry\.id\);/);
  });

  it("forgetting waits for a write already under way: what it lands is forgotten too (review 18.11.)", async () => {
    const journal = journalOf();
    const writer = createDraftWriter(journal, layout, { now });
    const file = layout.file(VAULT, "Note.md");
    await journal.record(VAULT, "Note.md", "older draft of another session", 1, "OLD");
    writer.write(VAULT, "Note.md", "typing 1", 1, "S");
    await settle();
    // A snapshot is on its way to the disk when the vault's drafts are forgotten…
    let open!: () => void;
    storage.gate = new Promise<void>((resolve) => { open = resolve; });
    clock += 400;
    writer.write(VAULT, "Note.md", "typing 2", 2, "S");
    await vi.advanceTimersByTimeAsync(0);
    const forgotten = journal.forgetSeen(VAULT);
    // …it lands, and only then are the files removed.
    storage.gate = null;
    open();
    await forgotten;
    storage.files.clear();
    clock += 400;
    writer.write(VAULT, "Note.md", "typing 3", 3, "S");
    await settle(400);
    expect(storage.entries(file).map((e) => `${e.sessionId}:${e.text}`)).toEqual(["S:typing 3"]);
  });

  it("a write that failed reads the file again: the disk may hold either version", async () => {
    const writer = createDraftWriter(journalOf(), layout, { now, retryMs: 400 });
    const file = layout.file(VAULT, "Note.md");
    writer.write(VAULT, "Note.md", "one", 1, "a");
    await settle();
    writer.write(VAULT, "Note.md", "other", 1, "b");
    clock += 400;
    await settle(400);
    const reads = storage.reads;
    storage.failOnce.add(file);
    writer.write(VAULT, "Note.md", "two", 2, "a");
    clock += 400;
    await settle(400);
    clock += 400;
    await settle(400);
    expect(storage.reads).toBeGreaterThan(reads);
    expect(storage.entries(file).map((e) => `${e.sessionId}:${e.text}`).sort()).toEqual(["a:two", "b:other"]);
  });

  it("leaving does not wait for the interval: a 6 MB note's newest text is in the journal at once", async () => {
    const writer = createDraftWriter(journalOf(), layout, { now });
    const file = layout.file(VAULT, "Big.md");
    const big = "x".repeat(6_000_000);
    writer.write(VAULT, "Big.md", big, 1, "s");
    await settle();
    clock += 100;
    writer.write(VAULT, "Big.md", `${big} last words`, 2, "s");
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.entries(file)[0].revision).toBe(1);
    await writer.flush(() => true, { notes: (path) => path === "Big.md" });
    expect(storage.entries(file)[0].text.endsWith(" last words")).toBe(true);
  });

  it("every way out of both shells writes at once", () => {
    const read = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", rel), "utf8");
    // Phone: the editor going (another note, the screen closing), and the app going to the background.
    const host = read("apps/mobile/src/EditorHost.tsx");
    expect(host).toMatch(/flushDraftOf\(vault, path\);\s*\/\/[^\n]*\n[^\n]*\n\s*void noteSaver\.flush\(path, vault\)/);
    expect(read("apps/mobile/src/services/appLifecycle.ts")).toMatch(/flushDrafts\(\)/);
    // Desktop: every save of a closing or switching editor records its text unthrottled, and the page going flushes the rest.
    expect(read("apps/desktop/src/components/Editor.tsx")).toMatch(/const persistText = async[\s\S]{0,1200}recordDraft\(draftVault, path, val/);
    expect(read("apps/desktop/src/services/draftJournal.ts")).toMatch(/flushDraftsOnLeave\(window, document\)/);
  });
});
