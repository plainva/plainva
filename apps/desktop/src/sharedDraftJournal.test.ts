import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDraftJournal,
  createDraftWriter,
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
  constructor(private readonly now: () => number) {}
  async read(file: string) {
    if (this.unreadable.has(file)) throw new Error("I/O error");
    return this.files.get(file)?.text ?? null;
  }
  async write(file: string, text: string) { this.writes += 1; this.files.set(file, { text, mtimeMs: this.now() }); }
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
