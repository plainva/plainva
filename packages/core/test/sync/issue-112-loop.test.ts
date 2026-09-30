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
import { SyncWorker, type NameCollision } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";

/**
 * Issue #112, the whole chain (ADR 0016): a folder made in Finder is stored
 * decomposed on the Mac, the server — HiDrive over WebDAV, byte-exact — holds
 * it composed, and the HiDrive desktop app syncs the same folder. The index
 * saw the decomposed file as new and the composed one as gone, the upload of
 * the "new" file failed with 409, `ensureDir` made a second, identical-looking
 * folder with MKCOL, and the desktop app renamed it "Neutralität(1)",
 * "Neutralität(2)", … — about forty.
 *
 * Everything here is the real core — the adapter chain the desktop builds,
 * the indexer with the shell's two sync hooks, queue, engine, worker, real
 * SQLite, the real WebDAV target — on a byte-exact disk (the CI's ext4)
 * against a byte-exact in-memory WebDAV server.
 */

const NFC = "Neutralität".normalize("NFC");
const NFD = NFC.normalize("NFD");
const BODY = "# Notiz\n\nhello\n";

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const worlds: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (worlds.length > 0) await worlds.pop()!();
});

interface World {
  root: string;
  db: IDatabaseAdapter;
  dav: ByteExactDav;
  queue: SyncQueue;
  indexer: VaultIndexer;
  worker: SyncWorker;
  collisions: (readonly NameCollision[])[];
  newLocal: string[];
  deletedLocal: string[];
  cycle(): Promise<void>;
  queued(): Promise<string[]>;
}

/**
 * A vault that synced "Neutralität/Notiz.md" before: the note was pulled
 * under the composed name and indexed there. Then the folder turned out to be
 * stored decomposed on this disk (Finder), exactly as APFS hands it back.
 */
async function world(opts: { remoteFolders?: string[]; diskFolder?: "decomposed" | "composed" } = {}): Promise<World> {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-112-"));
  const db = await realSqlite();
  worlds.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);

  const dav = byteExactDav();
  dav.folders.add(NFC);
  dav.files.set(`${NFC}/Notiz.md`, { bytes: new TextEncoder().encode(BODY), etag: "e0" });
  for (const f of opts.remoteFolders ?? []) dav.folders.add(f);

  // The synced state: note on disk (composed first), sync row composed, indexed.
  await fs.mkdir(path.join(root, NFC));
  await fs.writeFile(path.join(root, NFC, "Notiz.md"), BODY);
  const h = await sha(BODY);
  await db.execute(
    `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, last_sync_ts, base_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`${NFC}/Notiz.md`, h, "e0", h, "e0", Date.now(), BODY],
  );
  const newLocal: string[] = [];
  const deletedLocal: string[] = [];
  let live = false;
  const indexer = new VaultIndexer(raw, db, {
    onExternalModification: (p) => {
      if (live) void queue.queueWrite(p);
    },
    onNewLocalFile: (p) => {
      newLocal.push(p);
      if (live) void queue.queueWrite(p);
    },
    onLocalFileDeleted: (p) => {
      deletedLocal.push(p);
      if (live) void queue.queueDelete(p);
    },
  });
  await indexer.indexVaultFull();
  newLocal.length = 0;
  // …and the disk turns out to hold the folder decomposed (Finder, APFS).
  if ((opts.diskFolder ?? "decomposed") === "decomposed") {
    await fs.rename(path.join(root, NFC), path.join(root, NFD));
  }
  live = true;

  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as any).isRunning = true;
  const collisions: (readonly NameCollision[])[] = [];
  worker.onNameCollisions = (c) => void collisions.push(c);

  return {
    root, db, dav, queue, indexer, worker, collisions, newLocal, deletedLocal,
    async cycle() {
      // What the desktop does: the watcher's pass, then a sync cycle.
      await indexer.indexVaultFull();
      await new Promise((r) => setTimeout(r, 0));
      await worker.runCycle();
      await new Promise((r) => setTimeout(r, 0));
    },
    async queued() {
      const rows = await db.query<{ operation: string; file_path: string }>(`SELECT operation, file_path FROM offline_queue ORDER BY id`);
      return rows.map((r) => `${r.operation} ${r.file_path}`);
    },
  };
}

describe("issue #112: one folder, two spellings, no second folder on the server", () => {
  it("syncs a note made in the decomposed folder into the server's composed one, twice, without MKCOL or DELETE", async () => {
    const w = await world();
    expect(NFC).not.toBe(NFD);
    // Made in Finder next to the synced note.
    await fs.writeFile(path.join(w.root, NFD, "Neu.md"), "new note\n");

    await w.cycle();
    await w.cycle();

    // The server still has exactly one folder, the one it had.
    expect([...w.dav.folders].sort()).toEqual(["", NFC]);
    expect([...w.dav.files.keys()].sort()).toEqual([`${NFC}/Neu.md`, `${NFC}/Notiz.md`]);
    expect(w.dav.log.filter((l) => l.startsWith("MKCOL") || l.startsWith("DELETE") || l.startsWith("MOVE"))).toEqual([]);
    expect(w.dav.log.filter((l) => l.startsWith("PUT"))).toEqual([`PUT ${NFC}/Neu.md`]);
    // The index read the decomposed folder as the known one: nothing new but
    // the new note, nothing gone.
    expect(w.newLocal).toEqual([`${NFC}/Neu.md`]);
    expect(w.deletedLocal).toEqual([]);
    expect(await w.queued()).toEqual([]);
    // Nothing on disk was renamed or copied.
    expect(await fs.readdir(w.root)).toEqual(expect.arrayContaining([NFD]));
    expect(await fs.readdir(w.root)).not.toContain(NFC);
    expect((await fs.readdir(path.join(w.root, NFD))).sort()).toEqual(["Neu.md", "Notiz.md"]);
    expect(w.collisions.at(-1)).toEqual([]);
  });

  it("edits a synced note in the decomposed folder in place on the server", async () => {
    const w = await world();
    await w.cycle();
    await fs.writeFile(path.join(w.root, NFD, "Notiz.md"), `${BODY}more\n`);
    await w.cycle();
    await w.cycle();
    expect(new TextDecoder().decode(w.dav.files.get(`${NFC}/Notiz.md`)!.bytes)).toBe(`${BODY}more\n`);
    expect([...w.dav.folders].sort()).toEqual(["", NFC]);
    expect(w.dav.log.filter((l) => l.startsWith("MKCOL") || l.startsWith("DELETE"))).toEqual([]);
  });

  it("reports a folder the server holds in both spellings, and never copies the twin here", async () => {
    const w = await world({ diskFolder: "composed", remoteFolders: [NFD] });
    w.dav.files.set(`${NFD}/Notiz.md`, { bytes: new TextEncoder().encode("the twin\n"), etag: "t0" });

    await w.cycle();
    await w.cycle();

    expect(await fs.readdir(w.root)).not.toContain(NFD);
    expect(await fs.readFile(path.join(w.root, NFC, "Notiz.md"), "utf8")).toBe(BODY);
    expect(w.collisions.at(-1)).toEqual([{ path: `${NFD}/Notiz.md`, twin: `${NFC}/Notiz.md` }]);
    // Plainva deletes nothing on either side.
    expect(w.dav.files.get(`${NFD}/Notiz.md`)).toBeDefined();
    expect(w.dav.log.filter((l) => l.startsWith("DELETE") || l.startsWith("PUT") || l.startsWith("MKCOL"))).toEqual([]);
  });

  it("does not create an empty remote folder here again in the other spelling", async () => {
    // The server lists an empty folder decomposed; this disk has it composed.
    const empty = "Übersicht".normalize("NFC");
    const w = await world({ diskFolder: "composed", remoteFolders: [empty.normalize("NFD")] });
    await fs.mkdir(path.join(w.root, empty));
    await w.cycle();
    expect((await fs.readdir(w.root)).sort()).toEqual([NFC, empty].sort());
  });

  it("does not create a composed empty folder next to the decomposed one here", async () => {
    const w = await world({ remoteFolders: [] });
    await w.cycle();
    expect(await fs.readdir(w.root)).not.toContain(NFC);
  });

  it("queues no upload of a note the server confirmed, whichever spelling the disk shows (enqueueLocalOnlyFiles)", async () => {
    const w = await world();
    await w.indexer.indexVaultFull();
    await w.queue.enqueueLocalOnlyFiles();
    expect(await w.queued()).toEqual([]);
  });
});
