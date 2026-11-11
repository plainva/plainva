import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav } from "../helpers/byteExactDav.js";
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
import { isInternalPath } from "../../src/vault/internalPath.js";
import { isWorkspaceNamespacePath } from "../../src/workspace/path.js";

/**
 * A plain vault folder that holds a local `.pvws/` (R8, fourth review): a
 * copied former workspace, a restored backup, a vault that pulled `.pvws`
 * before the plain sync left it alone. Bound to a plain cloud folder, its
 * genesis must never go up - the next listing would show it, and every device
 * on that folder would be told to pair, by a person who never had a workspace
 * there. The real chain: disk, index, queue, engine, worker, WebDAV.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("the workspace namespace is never part of the plain vault (R8)", () => {
  it("one rule for every spelling", () => {
    for (const p of [".pvws", ".pvws/genesis.pvgen", ".PVWS/Genesis.pvgen", ".pvws./x", ".Pvws/objects/ab"]) {
      expect(isWorkspaceNamespacePath(p), p).toBe(true);
      expect(isInternalPath(p), p).toBe(true);
    }
    for (const p of ["pvws/x.md", ".pvwsnotes.md", "notes/.pvws.md"]) expect(isWorkspaceNamespacePath(p), p).toBe(false);
  });

  it("a local .pvws is not indexed, not queued and not uploaded on the first sync, and the worker is not halted", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-pvws-"));
    const db = await realSqlite();
    cleanups.push(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
    await fs.mkdir(path.join(root, ".pvws"), { recursive: true });
    await fs.writeFile(path.join(root, ".pvws", "genesis.pvgen"), "genesis");
    await fs.writeFile(path.join(root, "note.md"), "# Note\n");

    const raw = new LocalVaultAdapter(root);
    await raw.initialize();
    const backup = new BackupVaultAdapter(raw);
    const queue = new SyncQueue(db);
    const repo = new SyncStateRepository(db);
    const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
    const indexer = new VaultIndexer(raw, db, { onNewLocalFile: (p) => void queue.queueWrite(p) });
    await indexer.indexVaultFull();
    const indexed = await db.query<{ path: string }>("SELECT path FROM files");
    expect(indexed.map((r) => r.path)).toEqual(["note.md"]);

    // Something writes into the namespace through the app's chain: nothing is queued.
    await app.writeTextFile(".pvws/objects/x", "cipher");
    // Even a stale index row from an older version stays out of the first sync's queue.
    await db.execute("INSERT INTO files (path, mtime, hash) VALUES (?, ?, ?)", [".pvws/genesis.pvgen", 1, "h"]).catch(() => undefined);
    await queue.enqueueLocalOnlyFiles();
    const queued = await db.query<{ file_path: string }>("SELECT file_path FROM offline_queue");
    expect(queued.map((r) => r.file_path).filter((p) => p.toLowerCase().includes(".pvws"))).toEqual([]);

    const dav = byteExactDav();
    const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
    const engine = new SyncEngine(queue, target, app, repo);
    const reasons: Array<string | undefined> = [];
    const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
    (worker as unknown as { isRunning: boolean }).isRunning = true;
    worker.onStatusChange = (_s, _m, reason) => reasons.push(reason);
    worker.onFirstCycleComplete = () => void queue.enqueueLocalOnlyFiles();
    await worker.runCycle();
    await new Promise((r) => setTimeout(r, 0));
    await worker.runCycle();
    await worker.runCycle();
    expect([...dav.files.keys()].some((p) => p.toLowerCase().startsWith(".pvws"))).toBe(false);
    expect([...dav.files.keys()]).toContain("note.md");
    expect(reasons).not.toContain("encrypted-workspace");
  });
});
