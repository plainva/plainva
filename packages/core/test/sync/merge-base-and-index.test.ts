import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
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
 * A change that waits for its upload, and an index that has not caught up
 * (finding 2026-10-09).
 *
 * Whether a local change survives the next change from another device must
 * not depend on whether the index happened to know the file. It did: a file
 * with a sync row and no index entry was taken for new, and its current text
 * written over the merge base the sync had stored. Then "both devices changed
 * it" merged against the local text itself — the other device's version came
 * out, the local change was gone, and no conflict copy was written.
 *
 * Two ways into that state are walked here, each with a note and with a text
 * file that is no note:
 *  - a file a pull wrote that no pass looked at before the next full scan —
 *    what the phone did with every file that is no note, and what any shell
 *    does when the pass after a pull fails;
 *  - the index dropped to be rebuilt (the desktop's "rebuild the index").
 *
 * The real core throughout, as in text-shape-sync.test.ts: the adapter chain,
 * indexer, queue, engine, worker and the WebDAV target, real SQLite and real
 * folders, against a byte-exact in-memory server. The assertions read the
 * files on both disks and on the server.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function device(dav: ByteExactDav) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-merge-base-"));
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
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  // The shells' hooks queue without waiting; here one after the other (one
  // connection, one transaction at a time).
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const file = (p: string) => path.join(root, p);
  return {
    app, repo, db, indexer,
    /** What a shell does around a cycle: the pass over the vault, the cycle, and the index told what the cycle wrote. */
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    /** The worker's cycle alone: nothing tells the index what it wrote. */
    async syncOnly() {
      await worker.runCycle();
      pulled.length = 0;
      await queued;
    },
    /** A full scan — a start of the app, a return to it, a manual refresh. */
    async fullScan(trigger?: string) {
      await indexer.indexVaultFull(trigger);
      await queued;
    },
    async known(p: string) { return (await db.queryOne("SELECT path FROM files WHERE path = ?", [p])) !== null; },
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, text: string) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
    },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dav = byteExactDav();
  const remote = (p: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(dav.files.get(p)!.bytes);
  return { dav, remote };
}

/** One file in three states: as both devices hold it, as each of them changes it, and both changes together. */
const cases = [
  {
    name: "Note.md",
    start: "# Plan\n\none\ntwo\nthree\nfour\nfive\n",
    here: "# Plan\n\none here\ntwo\nthree\nfour\nfive\n",
    there: "# Plan\n\none\ntwo\nthree\nfour\nfive there\n",
    both: "# Plan\n\none here\ntwo\nthree\nfour\nfive there\n",
  },
  {
    name: "Settings.ini",
    start: `${MARK}[view]\r\nzoom=1\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=off\r\n`,
    here: `${MARK}[view]\r\nzoom=2\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=off\r\n`,
    there: `${MARK}[view]\r\nzoom=1\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=on\r\n`,
    both: `${MARK}[view]\r\nzoom=2\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=on\r\n`,
  },
] as const;

describe("a pulled file no pass looked at before the next full scan", () => {
  for (const c of cases) {
    it(`${c.name}: changed here before the scan and on the other device — both changes arrive on both`, async () => {
      const w = world();
      const a = await device(w.dav), b = await device(w.dav);
      await a.put(c.name, c.start);
      await a.cycle();
      // This device pulls the file for the first time, and nothing tells its index.
      await b.syncOnly();
      expect(await b.text(c.name)).toBe(c.start);
      expect(await b.known(c.name)).toBe(false);

      // The other device changes it and uploads; here it is changed through the
      // app's own write chain, and that change waits for its upload.
      await a.put(c.name, c.there);
      await a.cycle();
      await b.app.writeTextFile(c.name, c.here);
      // The next full scan — the pass that took the sync row for an orphan and
      // made the changed text its merge base.
      await b.fullScan();
      expect.soft((await b.repo.getSyncState(c.name))?.base_text).toBe(c.start);

      await b.syncOnly();
      // It used to end with the other device's version alone: no conflict copy, the change here gone.
      expect(await b.text(c.name)).toBe(c.both);
      expect(w.remote(c.name)).toBe(c.both);
      await a.cycle();
      expect(await a.text(c.name)).toBe(c.both);
      expect(await a.files()).toEqual([c.name]);
      expect(await b.files()).toEqual([c.name]);
    });
  }

  it("the same line changed on both devices is a conflict copy, not a choice made in silence", async () => {
    const w = world();
    const a = await device(w.dav), b = await device(w.dav);
    await a.put("Settings.ini", "[view]\nzoom=1\n");
    await a.cycle();
    await b.syncOnly();
    await a.put("Settings.ini", "[view]\nzoom=3\n");
    await a.cycle();
    await b.app.writeTextFile("Settings.ini", "[view]\nzoom=2\n");
    await b.fullScan();
    await b.syncOnly();
    // The other device's version is the file; this device's is kept beside it.
    expect(await b.text("Settings.ini")).toBe("[view]\nzoom=3\n");
    const kept = (await b.files()).filter((name) => name.includes(".CONFLICT"));
    expect(kept).toHaveLength(1);
    expect(await b.text(kept[0]!)).toBe("[view]\nzoom=2\n");
  });
});

describe("the index dropped to be rebuilt while changes wait for their upload", () => {
  it("keeps every change made here when the other device changed the same files", async () => {
    const w = world();
    const a = await device(w.dav), b = await device(w.dav);
    for (const c of cases) await a.put(c.name, c.start);
    await a.cycle();
    await b.cycle();

    for (const c of cases) await b.app.writeTextFile(c.name, c.here);
    for (const c of cases) await a.put(c.name, c.there);
    await a.cycle();

    // The desktop's "rebuild the index": every indexed row goes, sync_state stays.
    await b.db.execute("DELETE FROM files");
    await b.db.execute("DELETE FROM fts_notes");
    await b.fullScan("index rebuild");
    for (const c of cases) expect.soft((await b.repo.getSyncState(c.name))?.base_text, c.name).toBe(c.start);

    await b.cycle();
    for (const c of cases) {
      expect.soft(await b.text(c.name), c.name).toBe(c.both);
      expect.soft(w.remote(c.name), c.name).toBe(c.both);
    }
    await a.cycle();
    for (const c of cases) expect(await a.text(c.name), c.name).toBe(c.both);
    expect(await a.files()).toEqual(cases.map((c) => c.name));
    expect(await b.files()).toEqual(cases.map((c) => c.name));
  });
});
