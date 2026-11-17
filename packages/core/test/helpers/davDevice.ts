import { afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./realSqlite.js";
import { byteExactDav, type ByteExactDav, type ByteExactDavOptions } from "./byteExactDav.js";
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
 * One device of a two-device sync test: the real core (adapter chain,
 * indexer, queue, engine, worker, WebDAV target, SQLite, a real folder)
 * against a shared byte-exact in-memory WebDAV server. Files changed with
 * `put`/`remove`/`removeDir` are changed past the app, as another program
 * would; `app` writes through the chain.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

export async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, "/");
    if (rel.startsWith(".")) continue;
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else out.push(rel);
  }
  return out.sort();
}

export async function device(dav: ByteExactDav, options: {
  queueing?: ConstructorParameters<typeof QueueingVaultAdapter>[2];
  /** Acts as a remote that refuses to delete a folder holding a file (as S3 does). */
  deletesFolderOnlyWhileEmpty?: boolean;
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-dav-device-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue, options.queueing), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => dav.fetch(input, init));
  target.allowRootCreation = false;
  if (options.deletesFolderOnlyWhileEmpty) (target as { deletesFolderOnlyWhileEmpty?: boolean }).deletesFolderOnlyWhileEmpty = true;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const file = (p: string) => path.join(root, p);
  return {
    app, repo, queue, indexer, db,
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    async put(p: string, text: string) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
    },
    /** Another program removes the file, past the app (the indexer queues the deletion). */
    async remove(p: string) { await fs.rm(file(p)); },
    /** Another program removes the folder and everything in it, past the app. */
    async removeDir(p: string) { await fs.rm(file(p), { recursive: true }); },
    async makeDir(p: string) { await fs.mkdir(file(p), { recursive: true }); },
    async exists(p: string) { return fs.stat(file(p)).then(() => true, () => false); },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    async files() { return walk(root); },
  };
}

export function world(options?: ByteExactDavOptions) {
  if (!process.env.PLAINVA_DEBUG_SYNC) {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  }
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav(undefined, options);
  const remote = (p: string) => {
    const f = dav.files.get(p);
    return f ? new TextDecoder().decode(f.bytes) : null;
  };
  return { dav, remote };
}

