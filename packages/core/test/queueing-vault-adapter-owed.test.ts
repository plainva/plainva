import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { QueueingVaultAdapter, formatQueueEntryReport, type QueueEntryReport } from "../src/vault/QueueingVaultAdapter.ts";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.ts";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { realSqlite } from "./helpers/realSqlite.ts";

/**
 * A write whose change is on disk does not fail for a moment's trouble with
 * its entry in the sync queue: the entry is made up for while the write waits
 * (finding 2026-10-12).
 *
 * `QueueingVaultAdapter` changes the disk first and queues the change second.
 * An entry that failed used to fail the write at once: the caller heard "not
 * saved" for a file that was saved, the chain above did not take note of its
 * own write (the next one met a disk it did not know), and nothing was
 * queued. On the phone a second transaction was refused while one was open,
 * so any write that met the sync or the index at work ended like that; on the
 * desktop a write that meets a locked database, or a vault that is closing,
 * still can.
 *
 * An entry that still fails 30 seconds after its change is given up, and its
 * write fails as before (finding 2026-10-19, from the review of the
 * change): the chain then takes no note of the write, and the index announces
 * the file on its next pass — the net that a write returning early would have
 * torn. While the database keeps failing, the next entries are given up at
 * their first failure.
 *
 * Here the database refuses as often as a test says, and counts. Nothing waits
 * for a timer to fire or not to fire: where a test needs an entry to wait, its
 * next attempt is a minute away, and the clock that decides about giving up is
 * the test's.
 */

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const until = async (done: () => Promise<boolean> | boolean, what: string, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error(`waited in vain for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** A real SQLite that refuses the next transactions it is asked for — as a locked or closing database does. */
function refusing(inner: IDatabaseAdapter) {
  let refusals = 0;
  let given = 0;
  let message = "database is locked";
  const database: IDatabaseAdapter = {
    initialize: () => inner.initialize(),
    close: () => inner.close(),
    execute: (sql, params) => inner.execute(sql, params),
    query: (sql, params) => inner.query(sql, params),
    queryOne: (sql, params) => inner.queryOne(sql, params),
    transaction(fn) {
      if (refusals > 0) {
        refusals -= 1;
        given += 1;
        return Promise.reject(new Error(message));
      }
      return inner.transaction(fn);
    },
  };
  return {
    database,
    refuse(times: number, why = "database is locked") {
      refusals = times;
      message = why;
    },
    /** How many transactions were refused so far. */
    refused: () => given,
  };
}

let root: string;
let disk: LocalVaultAdapter;
let db: IDatabaseAdapter;
let refuse: (times: number, why?: string) => void;
let refused: () => number;
let adapter: QueueingVaultAdapter;
let reports: QueueEntryReport[];
let announced: number;
const listener = () => { announced += 1; };
/** Adapters a test made beside the shared one; each is flushed at the end. */
const made: QueueingVaultAdapter[] = [];
const queueing = (options: ConstructorParameters<typeof QueueingVaultAdapter>[2] = {}) => {
  const link = new QueueingVaultAdapter(disk, new SyncQueue(db), { onEntry: (report) => reports.push(report), ...options });
  made.push(link);
  return link;
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-queue-owed-"));
  disk = new LocalVaultAdapter(root);
  await disk.initialize();
  const sqlite = refusing(await realSqlite());
  db = sqlite.database;
  refuse = sqlite.refuse;
  refused = sqlite.refused;
  reports = [];
  announced = 0;
  // Where the shells listen for a new entry: the desktop syncs soon on it.
  (globalThis as { window?: EventTarget }).window = new EventTarget();
  window.addEventListener("plainva-sync-queued", listener);
  adapter = queueing({ retryAtMs: [5, 15, 35] });
});

afterEach(async () => {
  refuse(0);
  for (const each of made.splice(0)) await each.flush();
  await disk.dispose();
  window.removeEventListener("plainva-sync-queued", listener);
  delete (globalThis as { window?: EventTarget }).window;
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const queued = async () =>
  (await db.query<{ operation: string; file_path: string; new_path: string | null }>("SELECT operation, file_path, new_path FROM offline_queue ORDER BY id"))
    .map((op) => `${op.operation} ${op.file_path}${op.new_path ? ` -> ${op.new_path}` : ""}`);

describe("an entry of the sync queue that fails after the change is on disk", () => {
  it("does not fail the write: the entry is made up for, and the write returns once it is in the queue", async () => {
    refuse(1);
    // It used to reject here: "database is locked", for a file that was saved.
    await adapter.writeTextFile("Note.md", "the text");
    expect(await disk.readTextFile("Note.md")).toBe("the text");
    expect(await queued()).toEqual(["write Note.md"]);
    expect(reports).toEqual([{ outcome: "made-up", kind: "write", attempts: 2 }]);
    // The shells are told once the entry is there, not before, and once.
    expect(announced).toBe(1);
  });

  it("an attachment, a new folder, a rename and a confirmed deletion alike", async () => {
    await adapter.writeTextFile("Old.md", "old");
    await adapter.writeTextFile("Gone.md", "gone");
    refuse(1);
    await adapter.writeBinaryFile("photo.jpg", new Uint8Array([1, 2, 3]));
    refuse(1);
    await adapter.createDir("Inbox");
    refuse(1);
    await adapter.renameItem("Old.md", "New.md");
    refuse(1);
    await adapter.deleteItem("Gone.md", false, { confirmed: true });
    const entries = await queued();
    for (const entry of ["write photo.jpg", "mkdir Inbox", "rename Old.md -> New.md", "delete Gone.md"]) expect(entries).toContain(entry);
    // The person's confirmation travels with an entry that was made up for.
    const deletion = await db.queryOne<{ delete_confirmed_at: number | null }>("SELECT delete_confirmed_at FROM offline_queue WHERE operation = 'delete'");
    expect(deletion?.delete_confirmed_at).not.toBeNull();
    expect(reports.map((report) => report.outcome === "made-up" && report.kind)).toEqual(["write", "mkdir", "rename", "delete"]);
  });

  it("entries are written in the order their changes happened: one that waits holds back the ones after it", async () => {
    const slow = queueing({ retryAtMs: [60_000], giveUpAfterMs: 120_000 });
    // The write's entry fails twice: at once, and when the rename after it comes along.
    refuse(2);
    const write = slow.writeTextFile("Draft.md", "a draft");
    await until(() => refused() === 1, "the write's first attempt");
    const rename = slow.renameItem("Draft.md", "Letter.md");
    await until(() => refused() === 2, "the write's second attempt, when the rename came along");
    // Both changes are on disk, and both entries wait — the rename behind the write.
    expect(await disk.exists("Letter.md")).toBe(true);
    expect(await queued()).toEqual([]);
    // A third change comes along, and the database answers again.
    await slow.createDir("Inbox");
    await Promise.all([write, rename]);
    // The write came first, so the rename took it along to the new name (the
    // queue does that with a write that waits). Queued the other way round, an
    // upload of Draft.md would stand after the move that took the file away
    // from that name: "write Draft.md" after the rename.
    expect(await queued()).toEqual(["rename Draft.md -> Letter.md", "write Letter.md", "mkdir Inbox"]);
  });

  it("a later entry coming along tries the one that waits at once, without waiting for its next attempt", async () => {
    const slow = queueing({ retryAtMs: [60_000], giveUpAfterMs: 120_000 });
    refuse(1);
    const one = slow.writeTextFile("One.md", "1");
    await until(() => refused() === 1, "the first attempt");
    await slow.writeTextFile("Two.md", "2");
    await one;
    expect(await queued()).toEqual(["write One.md", "write Two.md"]);
  });

  it("an entry that still fails when its time is up is given up: its write fails, and it is reported", async () => {
    let clock = 0;
    const timed = queueing({ retryAtMs: [5], giveUpAfterMs: 30_000, now: () => clock });
    refuse(Number.POSITIVE_INFINITY, "database not initialized");
    const first = timed.writeTextFile("First.md", "1");
    const firstFails = expect(first).rejects.toThrow("database not initialized");
    await until(() => refused() >= 3, "a few attempts while there is time");
    expect(reports).toEqual([]);
    // Thirty seconds after the change: the entry is given up at its next attempt.
    clock = 30_000;
    await firstFails;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ outcome: "lost", kind: "write" });
    expect(reports[0].attempts).toBeGreaterThanOrEqual(4);
    expect(await disk.readTextFile("First.md")).toBe("1");
    expect(await queued()).toEqual([]);
    expect(formatQueueEntryReport({ outcome: "lost", kind: "write", attempts: 5, error: new Error("database not initialized") })).toBe(
      "a write entry of the sync queue could not be written (5 attempts: database not initialized) — the change is on disk, and its write was reported as failed",
    );
  });

  it("while the database keeps failing, the next entry is given up at its first failure; once one is written, entries wait again", async () => {
    let clock = 0;
    const timed = queueing({ retryAtMs: [5], giveUpAfterMs: 1_000, now: () => clock });
    refuse(Number.POSITIVE_INFINITY, "database not initialized");
    const first = timed.writeTextFile("First.md", "1");
    const firstFails = expect(first).rejects.toThrow("database not initialized");
    await until(() => refused() >= 2, "the first entry's attempts");
    clock = 1_000;
    await firstFails;
    // A loop of writes against a database that does not answer: one attempt each, no waiting.
    const before = refused();
    await expect(timed.writeTextFile("Second.md", "2")).rejects.toThrow("database not initialized");
    await expect(timed.writeTextFile("Third.md", "3")).rejects.toThrow("database not initialized");
    expect(refused() - before).toBe(2);
    expect(reports.slice(1).map((report) => [report.outcome, report.attempts])).toEqual([["lost", 1], ["lost", 1]]);
    // The database answers again: an entry is written, and the next one that fails waits again.
    refuse(0);
    await timed.writeTextFile("Fourth.md", "4");
    refuse(1);
    await timed.writeTextFile("Fifth.md", "5");
    expect(await queued()).toEqual(["write Fourth.md", "write Fifth.md"]);
    expect(reports.at(-1)).toMatchObject({ outcome: "made-up", kind: "write", attempts: 2 });
  });

  it("before the database closes, an entry that waits gets its last attempt: written if the database answers, given up if not", async () => {
    const slow = queueing({ retryAtMs: [60_000], giveUpAfterMs: 120_000 });
    refuse(1);
    const one = slow.writeTextFile("One.md", "1");
    await until(() => refused() === 1, "the first attempt");
    // Its next attempt is a minute away; the vault closes now.
    await slow.flush();
    await one;
    expect(await queued()).toEqual(["write One.md"]);

    const other = queueing({ retryAtMs: [60_000], giveUpAfterMs: 120_000 });
    refuse(Number.POSITIVE_INFINITY, "database not initialized");
    const two = other.writeTextFile("Two.md", "2");
    const twoFails = expect(two).rejects.toThrow("database not initialized");
    await until(() => refused() === 2, "the second write's first attempt");
    await other.flush();
    await twoFails;
    expect(reports.at(-1)).toMatchObject({ outcome: "lost", kind: "write", attempts: 2 });
    // Once flushed, an entry gets one attempt and no wait.
    await expect(other.writeTextFile("Three.md", "3")).rejects.toThrow("database not initialized");
    expect(reports.at(-1)).toMatchObject({ outcome: "lost", kind: "write", attempts: 1 });
  });

  it("a write whose disk change fails is a failed write, and nothing is queued", async () => {
    const broken = new QueueingVaultAdapter({ ...disk, writeTextFile: async () => { throw new Error("disk full"); } } as unknown as LocalVaultAdapter, new SyncQueue(db));
    await expect(broken.writeTextFile("Note.md", "text")).rejects.toThrow("disk full");
    expect(await queued()).toEqual([]);
  });
});

describe("the chain above, and the index", () => {
  it("takes note of a write whose entry was made up for: typing on after it is an ordinary write, no conflict", async () => {
    const repo = new SyncStateRepository(db, disk, "device");
    let merges = 0;
    const chain = new ConflictAwareVaultAdapter(adapter, repo, () => { merges += 1; }, repo, "container");
    // A note as a sync left it: on disk, and known.
    const synced = "# Letter\n\nDear Ada,\n";
    await disk.writeTextFile("Letter.md", synced);
    await repo.updateLocalHashAndBaseText("Letter.md", sha(synced), synced);

    refuse(1);
    const typed = `${synced}thank you for`;
    // It used to reject, and the chain kept the hash of the synced text.
    await chain.writeTextFile("Letter.md", typed);
    expect((await repo.getSyncState("Letter.md"))?.local_sha256).toBe(sha(typed));

    const typedOn = `${typed} the letter.\n`;
    // It used to meet a disk it did not know, try to merge the two versions of
    // the same line, and end in a conflict copy.
    await chain.writeTextFile("Letter.md", typedOn);
    expect(await disk.readTextFile("Letter.md")).toBe(typedOn);
    expect(merges).toBe(0);
    expect(await chain.listConflictSessions()).toEqual([]);
    expect((await fs.readdir(root)).filter((name) => name.includes(".CONFLICT"))).toEqual([]);
    expect(await queued()).toEqual(["write Letter.md"]);
  });

  it("takes no note of a write whose entry was given up — and the next index pass announces the file, as it always did", async () => {
    const repo = new SyncStateRepository(db, disk, "device");
    const strict = queueing({ giveUpAfterMs: 0 });
    const chain = new ConflictAwareVaultAdapter(strict, repo, () => {}, repo, "container");
    const external: string[] = [];
    const indexer = new VaultIndexer(chain, db, {
      isOwnWrite: (file, hash) => chain.wasWrittenByUs(file, hash),
      onExternalModification: (file) => external.push(file),
    });
    await disk.writeTextFile("Letter.md", "# Letter\n\nDear Ada,\n");
    await indexer.indexVaultFull();
    const known = (await repo.getSyncState("Letter.md"))?.local_sha256;
    expect(known).toBeTruthy();

    refuse(1);
    const typed = "# Letter\n\nDear Ada, thank you for the letter.\n";
    await expect(chain.writeTextFile("Letter.md", typed)).rejects.toThrow("database is locked");
    expect(await disk.readTextFile("Letter.md")).toBe(typed);
    expect((await repo.getSyncState("Letter.md"))?.local_sha256).toBe(known);
    expect(chain.wasWrittenByUs("Letter.md", sha(typed))).toBe(false);
    expect(await queued()).toEqual([]);

    // The shells queue what the index announces (`enqueueLocal`).
    await indexer.indexVaultFull();
    expect(external).toEqual(["Letter.md"]);
  });
});
