import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { DeletionJournal } from "../../src/sync/deletionJournal.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";

/**
 * After "Rebuild index" at the start (both shells): the damaged index
 * database is set aside, and the vault opens with an empty one — the sync
 * state, the queue and the deletion journal's base of before are gone, the
 * files are as they were. What the shells do then is what they do for a
 * device that never saw the vault, with its files already there (the cold
 * index, 3c): the full scan announces nothing for an upload until the first
 * pull has given the remote's state, and only then do the files the remote
 * does not have go up.
 *
 * Each case below is one state the device can be in when its database breaks,
 * and what the first sync after the rebuild does with it. The rule they hold
 * together: no note is deleted — not here, not on the server, not on another
 * device — and none is written over without its text being kept beside it.
 * The price, on purpose: a deletion or a rename the database knew of is
 * forgotten, so the file comes back or appears twice. The texts of the start
 * and the user guide say so.
 *
 * The real core throughout, wired as the shells wire it (deletion journal and
 * own-deletion register included), against a byte-exact in-memory server.
 */

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

/** A device on `root` with the index database `db`, wired as the shells wire it; `cold` holds new files back until the first pull (3c). */
function device(dav: ByteExactDav, root: string, db: IDatabaseAdapter, cold: boolean, id: string) {
  const raw = new LocalVaultAdapter(root);
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const journal = new DeletionJournal(raw, id);
  const own = new OwnDeletionRegister();
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  let deferNew = cold;
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => { if (!deferNew) later(() => queue.queueWrite(p)); },
    onLocalFileDeleted: (p, row) => {
      if (p.startsWith(".plainva")) return;
      if (own.consume(p, row)) return;
      later(() => queue.queueDelete(p));
    },
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000, { deletionJournal: journal, ownDeletions: own });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const guards: string[] = [];
  worker.onMassDeletionPending = (info) => void guards.push(`massDeletionPending ${info.pendingDeletes}/${info.syncedTotal}`);
  worker.onDeletionMirroringSuspended = (info) => void guards.push(`mirroringSuspended ${JSON.stringify(info)}`);
  let conflictCopies: string[] = [];
  worker.onFirstCycleComplete = (outcome) => { conflictCopies = outcome.conflictCopies; };
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const settle = async () => {
    for (const p of pulled.splice(0)) await indexer.indexPath(p);
    await queued;
  };
  return {
    raw,
    app,
    guards,
    get firstCycleConflictCopies() { return conflictCopies; },
    async open() {
      await raw.initialize();
      await indexer.indexVaultFull("open");
      await queued;
    },
    async cycle() {
      await worker.runCycle();
      await settle();
      if (deferNew) {
        // The first pull is through: what the remote does not have goes up now (the shells' onFirstCycleComplete).
        deferNew = false;
        await queue.enqueueLocalOnlyFiles();
        await worker.runCycle();
        await settle();
      }
    },
  };
}

async function folder(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-rebuilt-index-"));
  closers.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function database(): Promise<IDatabaseAdapter> {
  const db = await realSqlite();
  closers.push(() => db.close());
  return db;
}

const remote = (dav: ByteExactDav, p: string) => (dav.files.has(p) ? new TextDecoder().decode(dav.files.get(p)!.bytes) : null);
const local = (root: string, p: string) => fs.readFile(path.join(root, p), "utf8").catch(() => null);
const conflictCopiesIn = async (root: string, stem: string) => (await fs.readdir(root)).filter((n) => n.startsWith(stem) && n.includes("CONFLICT")).sort();
const notesOn = (dav: ByteExactDav) => [...dav.files.keys()].filter((k) => k.endsWith(".md")).length;
const notesIn = async (root: string) => (await fs.readdir(root)).filter((n) => n.endsWith(".md")).length;

/** This device (`a`, at `here`) and another one (`b`, at `there`), both in sync on `notes`. */
async function inSync(notes: Record<string, string>) {
  const dav = byteExactDav();
  const here = await folder();
  const there = await folder();
  const a = device(dav, here, await database(), false, "device-a");
  await a.open();
  for (const [name, text] of Object.entries(notes)) await a.raw.writeTextFile(name, text);
  await a.open();
  await a.cycle();
  const b = device(dav, there, await database(), false, "device-b");
  await b.open();
  await b.cycle();
  return { dav, here, there, a, b };
}

/** Here, the index database is damaged and set aside: an empty one, the same files, the first sync. */
async function rebuild(dav: ByteExactDav, here: string) {
  const rebuilt = device(dav, here, await database(), true, "device-a");
  await rebuilt.open();
  await rebuilt.cycle();
  return rebuilt;
}

describe("the first sync after the index database was rebuilt", () => {
  it("1: a deletion made here and never sent is forgotten — the note comes back from the server, nothing is deleted there", async () => {
    const { dav, here, a } = await inSync({ "Deleted.md": "# Deleted\n", "Keep.md": "# Keep\n" });
    await a.app.deleteItem("Deleted.md", false, { confirmed: true });
    expect(await local(here, "Deleted.md")).toBeNull();
    const rebuilt = await rebuild(dav, here);
    expect(await local(here, "Deleted.md")).toBe("# Deleted\n");
    expect(remote(dav, "Deleted.md")).toBe("# Deleted\n");
    expect(remote(dav, "Keep.md")).toBe("# Keep\n");
    expect(rebuilt.guards).toEqual([]);
  });

  it("2: a deletion another device already synced comes back while the note is still here — on the server and on that device", async () => {
    const { dav, here, there, b } = await inSync({ "Gone.md": "# Gone\n", "Keep.md": "# Keep\n" });
    await b.app.deleteItem("Gone.md", false, { confirmed: true });
    await b.open();
    await b.cycle();
    await b.cycle();
    expect(remote(dav, "Gone.md"), "deleted on the server before the rebuild").toBeNull();
    const rebuilt = await rebuild(dav, here);
    expect(remote(dav, "Gone.md"), "uploaded again: the rebuilt device does not know it was deleted").toBe("# Gone\n");
    await b.cycle();
    expect(await local(there, "Gone.md"), "and back on the device that deleted it").toBe("# Gone\n");
    expect(await local(here, "Gone.md")).toBe("# Gone\n");
    expect(rebuilt.guards).toEqual([]);
  });

  it("3: a note changed here (not sent) and on the server: the server's text in the note, this device's beside it as a conflict copy", async () => {
    const { dav, here, a, b } = await inSync({ "Edited.md": "# Edited\n\nbase\n" });
    await a.raw.writeTextFile("Edited.md", "# Edited\n\nchanged here, never sent\n");
    await b.raw.writeTextFile("Edited.md", "# Edited\n\nchanged on the other device\n");
    await b.open();
    await b.cycle();
    const rebuilt = await rebuild(dav, here);
    expect(await local(here, "Edited.md")).toBe("# Edited\n\nchanged on the other device\n");
    expect(remote(dav, "Edited.md")).toBe("# Edited\n\nchanged on the other device\n");
    const copies = await conflictCopiesIn(here, "Edited");
    expect(copies).toHaveLength(1);
    expect(await local(here, copies[0]!)).toBe("# Edited\n\nchanged here, never sent\n");
    expect(rebuilt.firstCycleConflictCopies).toHaveLength(1);
  });

  it("4: a rename made here and never sent is forgotten — the note is there under both names, here and on the server", async () => {
    const { dav, here, a } = await inSync({ "Old.md": "# Renamed\n" });
    await a.app.renameItem("Old.md", "New.md");
    const rebuilt = await rebuild(dav, here);
    expect(await local(here, "Old.md")).toBe("# Renamed\n");
    expect(await local(here, "New.md")).toBe("# Renamed\n");
    expect(remote(dav, "Old.md")).toBe("# Renamed\n");
    expect(remote(dav, "New.md")).toBe("# Renamed\n");
    expect(rebuilt.guards).toEqual([]);
  });

  it("5: a note made here and never sent goes up after the first pull", async () => {
    const { dav, here, a } = await inSync({ "Synced.md": "# Synced\n" });
    await a.raw.writeTextFile("Unsent.md", "# Unsent\n");
    await rebuild(dav, here);
    expect(remote(dav, "Unsent.md")).toBe("# Unsent\n");
    expect(remote(dav, "Synced.md")).toBe("# Synced\n");
  });

  it("6: a note the server has newer and this device unchanged: the server's text, the older one kept beside it", async () => {
    const { dav, here, b } = await inSync({ "Newer.md": "# Newer\n\nold\n" });
    await b.raw.writeTextFile("Newer.md", "# Newer\n\nnewer, from the other device\n");
    await b.open();
    await b.cycle();
    const rebuilt = await rebuild(dav, here);
    expect(await local(here, "Newer.md")).toBe("# Newer\n\nnewer, from the other device\n");
    expect(remote(dav, "Newer.md"), "the server's newer text is not written over").toBe("# Newer\n\nnewer, from the other device\n");
    const copies = await conflictCopiesIn(here, "Newer");
    expect(copies).toHaveLength(1);
    expect(await local(here, copies[0]!)).toBe("# Newer\n\nold\n");
    expect(rebuilt.firstCycleConflictCopies).toHaveLength(1);
  });

  it("6b: a note changed here and never sent, the server unchanged: the server's text in the note, this device's as a conflict copy", async () => {
    const { dav, here, a } = await inSync({ "Local.md": "# Local\n\nold\n" });
    await a.raw.writeTextFile("Local.md", "# Local\n\nchanged here, never sent\n");
    await rebuild(dav, here);
    expect(await local(here, "Local.md")).toBe("# Local\n\nold\n");
    expect(remote(dav, "Local.md")).toBe("# Local\n\nold\n");
    const copies = await conflictCopiesIn(here, "Local");
    expect(copies).toHaveLength(1);
    expect(await local(here, copies[0]!), "the change made here is never lost").toBe("# Local\n\nchanged here, never sent\n");
  });

  it("8: sixty notes in sync and nothing changed: nothing goes up, no conflict copy, no guard", async () => {
    const notes = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}.md`, `# ${i}\n`]));
    const { dav, here } = await inSync(notes);
    const before = dav.log.length;
    const rebuilt = await rebuild(dav, here);
    expect(dav.log.slice(before).filter((line) => line.startsWith("PUT") && line.endsWith(".md"))).toEqual([]);
    expect(await conflictCopiesIn(here, "m")).toEqual([]);
    expect(rebuilt.guards).toEqual([]);
  });

  it("9: another device deleted fifty of sixty: the rebuilt device brings all fifty back, on the server and on that device", async () => {
    const notes = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`n${i}.md`, `# ${i}\n`]));
    const { dav, here, there, b } = await inSync(notes);
    for (let i = 0; i < 50; i++) await b.app.deleteItem(`n${i}.md`, false, { confirmed: true });
    await b.open();
    await b.cycle();
    await b.cycle();
    expect(notesOn(dav)).toBe(10);
    const rebuilt = await rebuild(dav, here);
    expect(notesOn(dav)).toBe(60);
    expect(await notesIn(here)).toBe(60);
    await b.cycle();
    expect(await notesIn(there)).toBe(60);
    expect(rebuilt.guards).toEqual([]);
  });
});
