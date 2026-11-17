import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * After "Rebuild index" at the start (both shells): the damaged index
 * database is set aside, and the vault opens with an empty one — the sync
 * state, the queue and the deletion journal of before are gone, the files
 * are as they were. What the shells do then is what they do for a device that
 * never saw the vault (the cold index, 3c): the full scan announces nothing
 * for an upload until the first pull has given the remote's state, and only
 * then do the files the remote does not have go up.
 *
 * That must hold: nothing the server still has is deleted, and nothing the
 * server has newer is written over. The real core throughout, as in
 * merge-base-and-index.test.ts, against a byte-exact in-memory server.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

/** A device on `root` with the index database `db`, wired as the shells wire it; `cold` holds new files back until the first pull (3c). */
function device(dav: ByteExactDav, root: string, db: IDatabaseAdapter, cold: boolean) {
  const raw = new LocalVaultAdapter(root);
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  let deferNew = cold;
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => { if (!deferNew) later(() => queue.queueWrite(p)); },
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  return {
    raw,
    async open() {
      await raw.initialize();
      await indexer.indexVaultFull("open");
      await queued;
    },
    async cycle() {
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
      if (deferNew) {
        // The first pull is through: what the remote does not have goes up now (the shells' onFirstCycleComplete).
        deferNew = false;
        await queue.enqueueLocalOnlyFiles();
        await worker.runCycle();
        await queued;
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

describe("the first sync after the index database was rebuilt", () => {
  it("deletes nothing the server has, and writes nothing over what the server has newer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dav = byteExactDav();
    const remote = (p: string) => (dav.files.has(p) ? new TextDecoder().decode(dav.files.get(p)!.bytes) : null);

    // This device and another one, both in sync.
    const here = await folder();
    const there = await folder();
    const a = device(dav, here, await database(), false);
    await a.open();
    for (const [name, text] of [["Keep.md", "# Keep\n"], ["Edited.md", "# Edited\n\nold\n"], ["Gone.md", "# Gone\n"]]) await a.raw.writeTextFile(name, text);
    await a.open();
    await a.cycle();
    const b = device(dav, there, await database(), false);
    await b.open();
    await b.cycle();
    // The other device edits a note, adds one, and deletes one; this device has not seen any of it.
    await b.raw.writeTextFile("Edited.md", "# Edited\n\nnewer, from the other device\n");
    await b.raw.writeTextFile("Added.md", "# Added\n");
    await b.open();
    await b.cycle();
    expect(remote("Edited.md")).toContain("newer, from the other device");
    expect(remote("Added.md")).toBe("# Added\n");

    // Here the index database is damaged and set aside: an empty one, the same files.
    const rebuilt = device(dav, here, await database(), true);
    await rebuilt.open();
    await rebuilt.cycle();

    expect(remote("Edited.md"), "the server's newer text is not written over").toContain("newer, from the other device");
    expect(remote("Keep.md"), "nothing the server has is deleted").toBe("# Keep\n");
    expect(remote("Gone.md")).toBe("# Gone\n");
    expect(remote("Added.md")).toBe("# Added\n");
    expect(await rebuilt.raw.readTextFile("Added.md"), "what the server has is pulled").toBe("# Added\n");
    const edited = await rebuilt.raw.readTextFile("Edited.md");
    const copies = (await fs.readdir(here)).filter((name) => name.startsWith("Edited") && name.includes("CONFLICT"));
    // The newer text arrives here, or the older one is kept beside it as a conflict copy: never lost either way.
    expect(edited.includes("newer, from the other device") || copies.length > 0).toBe(true);
  });

  it("a note made here before the rebuild that the server never had goes up after the first pull", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dav = byteExactDav();
    const here = await folder();
    const a = device(dav, here, await database(), false);
    await a.open();
    await a.raw.writeTextFile("Synced.md", "# Synced\n");
    await a.open();
    await a.cycle();
    // Written here, never sent: the queue entry was in the database that is set aside.
    await a.raw.writeTextFile("Unsent.md", "# Unsent\n");
    const rebuilt = device(dav, here, await database(), true);
    await rebuilt.open();
    await rebuilt.cycle();
    expect(dav.files.has("Unsent.md")).toBe(true);
    expect(dav.files.has("Synced.md")).toBe(true);
  });
});
