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
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import type { NameCollisionCase } from "../../src/sync/nameTwins.js";

/**
 * Two spellings of a FOLDER (Fehlerliste 0.9.0 A10, Sammelplan § 3.175
 * no. 1): `Bäckerei/` composed and decomposed, side by side. Its notes are
 * twins of each other; resolving them (Remove duplicates, Keep both) emptied
 * the folder of the second spelling — and left it standing, here and in the
 * cloud, where it looked like a second, empty `Bäckerei`. Now a folder of the
 * second spelling that the resolution emptied goes with its last note.
 *
 * Real core as in name-twins.test.ts.
 */

const FOLDER = "Bäckerei".normalize("NFC");
const FOLDER_NFD = FOLDER.normalize("NFD");
const NAME = "Brötchen holen.md".normalize("NFC");
const NFC = `${FOLDER}/${NAME}`;
const NFD = `${FOLDER_NFD}/${NAME}`;
const BODY = "# Brötchen holen\n\n- [ ] beim Bäcker\n";
const OTHER_BODY = "# Brötchen holen\n\n- [x] beim Bäcker, schon erledigt\n";
const bytes = (text: string) => new TextEncoder().encode(text);

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function diskKeepsBothSpellings(): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-twin-probe-"));
  try {
    await fs.mkdir(path.join(probe, FOLDER));
    await fs.mkdir(path.join(probe, FOLDER_NFD));
    return (await fs.readdir(probe)).length === 2;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { recursive: true, force: true });
  }
}
const keepsBothSpellings = await diskKeepsBothSpellings();

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
  worker: SyncWorker;
  cases: (readonly NameCollisionCase[])[];
  changed: string[];
  cycle(): Promise<void>;
  settle(): Promise<void>;
  queued(): Promise<string[]>;
  onDisk(): Promise<string[]>;
}

/**
 * A synced note `Bäckerei/Brötchen holen.md` (composed, here and in the
 * cloud), plus whatever twin the test puts next to it.
 */
async function world(opts: { cloudTwin?: string; localTwin?: string; looseDelete?: boolean } = {}): Promise<World> {
  if (!process.env.PLAINVA_DEBUG_SYNC) {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-twins-"));
  const db = await realSqlite();
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);

  const dav = byteExactDav("https://dav.example.com/dav/Vault/", { clock: () => Date.UTC(2026, 8, 22, 13, 59) });
  dav.folders.add(FOLDER);
  if (opts.cloudTwin !== undefined) dav.folders.add(FOLDER_NFD);
  dav.files.set(NFC, { bytes: bytes(BODY), etag: "e-nfc", modified: Date.UTC(2026, 8, 22, 13, 59) });
  if (opts.cloudTwin !== undefined) dav.files.set(NFD, { bytes: bytes(opts.cloudTwin), etag: "e-nfd", modified: Date.UTC(2026, 8, 22, 13, 58) });
  await fs.mkdir(path.join(root, FOLDER));
  if (opts.localTwin !== undefined) await fs.mkdir(path.join(root, FOLDER_NFD));
  await fs.writeFile(path.join(root, NFC), BODY);
  if (opts.localTwin !== undefined) await fs.writeFile(path.join(root, NFD), opts.localTwin);
  // What the indexer does with a new file on this disk: queue it. The engine
  // holds a twin's write and reports it.
  if (opts.localTwin !== undefined) await queue.queueWrite(NFD);
  const h = await sha(BODY);
  await db.execute(
    `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, last_sync_ts, base_text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [NFC, h, "e-nfc", h, "e-nfc", Date.now(), BODY],
  );

  // A store that matches a DELETE looser than it lists names takes the
  // composed file along (the safety net after a removal).
  const fetch: typeof dav.fetch = async (input, init) => {
    const res = await dav.fetch(input, init);
    if (opts.looseDelete && (init?.method ?? "").toUpperCase() === "DELETE") dav.files.delete(NFC);
    return res;
  };
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as any).isRunning = true;
  const cases: (readonly NameCollisionCase[])[] = [];
  const changed: string[] = [];
  worker.onNameCollisionCases = (c) => void cases.push(c);
  worker.onFilesChanged = (p) => void changed.push(...p);
  worlds.push(async () => {
    worker.stop();
    await (worker as any).currentCycle?.catch(() => undefined);
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root, db, dav, queue, worker, cases, changed,
    async cycle() {
      await worker.runCycle();
    },
    async settle() {
      // The resolution starts a cycle of its own when it is done.
      await (worker as any).currentCycle?.catch(() => undefined);
    },
    async queued() {
      const rows = await db.query<{ operation: string; file_path: string }>(`SELECT operation, file_path FROM offline_queue ORDER BY id`);
      return rows.map((r) => `${r.operation} ${r.file_path}`);
    },
    async onDisk() {
      return (await fs.readdir(root)).filter((n) => !n.startsWith(".")).sort();
    },
  };
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const cloudFolders = (dav: ByteExactDav) => [...dav.folders].filter((f) => f !== "").sort();

describe("a folder of the second spelling", () => {
  it("goes from the cloud once Remove duplicates took its last note", async () => {
    const w = await world({ cloudTwin: BODY });
    await w.cycle();
    expect(cloudFolders(w.dav)).toEqual([FOLDER, FOLDER_NFD].sort());

    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();

    expect(result).toMatchObject({ removed: 1, skipped: 0 });
    expect([...w.dav.files.keys()]).toEqual([NFC]);
    expect(text(w.dav.files.get(NFC)!.bytes)).toBe(BODY);
    expect(cloudFolders(w.dav)).toEqual([FOLDER]);
    expect(await w.onDisk()).toEqual([FOLDER]);
  });

  it("goes from the cloud once Keep both moved its last note to a name of its own", async () => {
    const w = await world({ cloudTwin: OTHER_BODY });
    await w.cycle();
    await w.worker.resolveNameCollisions("keep-both");
    await w.settle();
    const copy = `${FOLDER}/${"Brötchen holen (2).md".normalize("NFC")}`;
    expect([...w.dav.files.keys()].sort()).toEqual([NFC, copy].sort());
    expect(text(w.dav.files.get(copy)!.bytes)).toBe(OTHER_BODY);
    expect(cloudFolders(w.dav)).toEqual([FOLDER]);
  });

  it.skipIf(!keepsBothSpellings)("goes from this device too, where it stood next to the composed folder", async () => {
    const w = await world({ localTwin: BODY });
    await w.cycle();
    expect(await w.onDisk()).toEqual([FOLDER, FOLDER_NFD].sort());
    await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();
    expect(await w.onDisk()).toEqual([FOLDER]);
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
  });

  it("stays while it holds a conflict copy, which no listing of the sync reports (F44)", async () => {
    const w = await world({ cloudTwin: BODY });
    const copy = `${FOLDER_NFD}/${"Brötchen holen.CONFLICT-2026-09-01.md".normalize("NFC")}`;
    w.dav.files.set(copy, { bytes: bytes("# other edit\n"), etag: "e-cc" });
    await w.cycle();
    await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();
    expect(text(w.dav.files.get(copy)?.bytes)).toBe("# other edit\n");
    expect(cloudFolders(w.dav)).toContain(FOLDER_NFD);
  });

  it("stays while it still holds a note of its own", async () => {
    const w = await world({ cloudTwin: BODY });
    const extra = `${FOLDER_NFD}/Eigenes.md`;
    w.dav.files.set(extra, { bytes: bytes("# Eigenes\n"), etag: "e-extra" });
    await w.cycle();
    await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();
    expect(w.dav.files.has(extra)).toBe(true);
    expect(cloudFolders(w.dav)).toContain(FOLDER_NFD);
  });
});
