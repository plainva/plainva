import { describe, it, expect, vi } from "vitest";
import {
  DeletionJournal,
  DELETION_JOURNAL_RETENTION_MS,
  mergeDeletionEntries,
  parseDeletionJournal,
  pruneDeletionEntries,
  serializeDeletionJournal,
  type DeletionJournalEntry,
} from "../../src/sync/deletionJournal.js";
import { DELETIONS_SYNC_PATH } from "../../src/settingsSync/paths.js";

const DAY = 24 * 60 * 60 * 1000;

function pathEntry(path: string, deletedAt: number, deviceId = "A"): DeletionJournalEntry {
  return { kind: "path", path, deletedAt, deviceId };
}

describe("deletion journal — file format", () => {
  it("round-trips entries and tolerates garbage", () => {
    const entries: DeletionJournalEntry[] = [
      pathEntry("notes/a.md", 1000),
      { kind: "task", uid: "u1", list: "l1", provider: "google", deletedAt: 2000, deviceId: "B" },
    ];
    expect(parseDeletionJournal(serializeDeletionJournal(entries))).toEqual(entries);
    expect(parseDeletionJournal(null)).toEqual([]);
    expect(parseDeletionJournal("not json")).toEqual([]);
    expect(parseDeletionJournal(JSON.stringify({ format: "other", entries: [] }))).toEqual([]);
    // A malformed entry is dropped, the rest survives.
    const mixed = JSON.stringify({ format: "plainva-deletions", version: 1, entries: [{ kind: "path" }, entries[0]] });
    expect(parseDeletionJournal(mixed)).toEqual([entries[0]]);
  });

  it("normalizes paths on parse (backslashes, ./, trailing slash)", () => {
    const text = serializeDeletionJournal([pathEntry(".\\Ordner\\Notiz.md/", 5)]);
    expect(parseDeletionJournal(text)[0]).toMatchObject({ path: "Ordner/Notiz.md" });
  });

  it("merges by identity, newer deletedAt wins, and prunes by retention", () => {
    const merged = mergeDeletionEntries(
      [pathEntry("a.md", 10, "A"), pathEntry("b.md", 20, "A")],
      [pathEntry("a.md", 30, "B"), pathEntry("c.md", 5, "B")]
    );
    expect(merged.map((e) => (e.kind === "path" ? `${e.path}@${e.deletedAt}` : ""))).toEqual([
      "c.md@5",
      "b.md@20",
      "a.md@30",
    ]);
    const now = 100 * DAY;
    const kept = pruneDeletionEntries(
      [pathEntry("old.md", now - DELETION_JOURNAL_RETENTION_MS - 1), pathEntry("fresh.md", now - DAY)],
      now
    );
    expect(kept.map((e) => (e.kind === "path" ? e.path : ""))).toEqual(["fresh.md"]);
  });
});

function fakeVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: vi.fn(async (p: string) => files.has(p)),
    readTextFile: vi.fn(async (p: string) => files.get(p) ?? ""),
    writeTextFile: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
  } as any;
}

function fakeTarget(remoteText: string | null) {
  return {
    download: vi.fn(async () => (remoteText === null ? null : new TextEncoder().encode(remoteText))),
    push: vi.fn(async () => undefined),
  } as any;
}

describe("DeletionJournal", () => {
  it("records confirmed deletions locally and explains children of a deleted folder", async () => {
    const vault = fakeVault();
    const journal = new DeletionJournal(vault, "dev-A", { now: () => 1000 });
    await journal.recordPaths(["Projekte/Alt", ".plainva/vault.db", ""]);

    expect(vault.files.has(DELETIONS_SYNC_PATH)).toBe(true);
    expect(journal.explainsPath("Projekte/Alt/notiz.md")).toMatchObject({ path: "Projekte/Alt", deviceId: "dev-A" });
    expect(journal.explainsPath("Projekte/Altbau.md")).toBeNull();
    // Internal paths are never journaled.
    expect(journal.list().some((e) => e.kind === "path" && e.path.startsWith(".plainva"))).toBe(false);
  });

  it("an entry older than the file's last sync does not explain it (recreated since)", async () => {
    const journal = new DeletionJournal(fakeVault(), "dev-A", { now: () => 1000 });
    await journal.recordPaths(["a.md"]);
    expect(journal.explainsPath("a.md", 500)).not.toBeNull();
    expect(journal.explainsPath("a.md", 2000)).toBeNull();
  });

  it("sync merges the remote journal in and publishes the union only when it adds something", async () => {
    const remote = serializeDeletionJournal([pathEntry("remote-deleted.md", 900, "dev-B")]);
    const vault = fakeVault();
    const journal = new DeletionJournal(vault, "dev-A", { now: () => 1000 });
    await journal.recordPaths(["local-deleted.md"]);

    const target = fakeTarget(remote);
    await journal.sync(target);

    // Local now knows the remote deletion...
    expect(journal.explainsPath("remote-deleted.md")).not.toBeNull();
    expect(journal.explainsPath("local-deleted.md")).not.toBeNull();
    // ...and the union went up exactly once.
    expect(target.push).toHaveBeenCalledTimes(1);
    const pushed = parseDeletionJournal(new TextDecoder().decode(target.push.mock.calls[0][0].content));
    expect(pushed.map((e) => (e.kind === "path" ? e.path : ""))).toEqual(["remote-deleted.md", "local-deleted.md"]);

    // A second sync against the published state uploads nothing.
    const quiet = fakeTarget(serializeDeletionJournal(journal.list()));
    await journal.sync(quiet);
    expect(quiet.push).not.toHaveBeenCalled();
  });

  it("sync with no remote and no local entries publishes nothing", async () => {
    const journal = new DeletionJournal(fakeVault(), "dev-A");
    const target = fakeTarget(null);
    await journal.sync(target);
    expect(target.push).not.toHaveBeenCalled();
  });

  it("task deletions are found by uid + list, provider/identity only when both carry them", async () => {
    const journal = new DeletionJournal(fakeVault(), "dev-A", { now: () => 1 });
    await journal.recordTask({ uid: "u1", list: "l1", provider: "google", identity: "me@x" });
    expect(journal.findTask({ uid: "u1", list: "l1" })).not.toBeNull();
    expect(journal.findTask({ uid: "u1", list: "l1", provider: "google", identity: "me@x" })).not.toBeNull();
    expect(journal.findTask({ uid: "u1", list: "l1", provider: "microsoft" })).toBeNull();
    expect(journal.findTask({ uid: "u1", list: "other" })).toBeNull();
  });

  it("a broken local file starts an empty journal instead of throwing", async () => {
    const vault = fakeVault({ [DELETIONS_SYNC_PATH]: "{{{" });
    const journal = new DeletionJournal(vault, "dev-A");
    await journal.load();
    expect(journal.list()).toEqual([]);
  });
});
