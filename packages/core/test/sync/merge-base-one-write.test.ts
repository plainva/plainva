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
import type { ISyncTarget, SyncContentRef, SyncOperation } from "../../src/sync/ISyncTarget.js";
import type { IVaultAdapter } from "../../src/vault/IVaultAdapter.js";

/**
 * The merge base of a file: the version this device and the remote last
 * agreed on — its hash, its ETag, and its text where it is one (Sammelplan
 * § 3.102 no. 2, 3, 6 and 7).
 *
 * A row that names one version and holds the text of another is no common
 * ancestor. Since § 3.93 the sync no longer merges against such a text — it
 * keeps the local version as a conflict copy instead — so none of what is
 * walked here lost data. But each of these ways left a row like that, or
 * took an untouched file for a changed one, and the person saw a conflict copy
 * of a change nobody else had made:
 *  - the hash and the text were written by two statements, by the worker
 *    after a pull and by the engine after an upload: an app that ended
 *    between the two left them apart (no. 7);
 *  - an upload streamed from disk moved the hash on and left the text of an
 *    earlier version in the row (no. 2);
 *  - a full index pass wrote the text of the file as it read it over a base
 *    that a first upload had recorded since the pass began (no. 3);
 *  - a file that travels byte for byte — an image, a `.csv` in Windows-1252 —
 *    changed here while the remote only got a new ETag was taken for "changed
 *    on both sides": the change became a conflict copy, and the file went
 *    back to the remote's version (no. 6).
 *
 * The real core: adapter chain, indexer, queue, engine, worker and the WebDAV
 * target, real SQLite and real folders, against a byte-exact in-memory server.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

const sha256 = async (bytes: Uint8Array | number[]) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
/** Windows-1252, for the characters used here (they sit where Latin-1 has them). */
const windows1252 = (text: string) => [...text].map((char) => char.charCodeAt(0));

type Row = { local_sha256: string | null; base_sha256: string | null; base_etag: string | null; base_text: string | null; remote_etag: string | null };

async function device(dav: ByteExactDav, options: { indexerFiles?: (raw: LocalVaultAdapter) => IVaultAdapter } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-base-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  // The app ends right after the first statement that writes a merge base,
  // while armed: every statement after it fails, as nothing after it would
  // have run.
  const execute = db.execute.bind(db);
  let armed = false;
  let ended = false;
  db.execute = async (sql: string, params?: unknown[]) => {
    if (ended) throw new Error("the app ended here");
    await execute(sql, params);
    if (armed && /sync_state/.test(sql) && /\bbase_(sha256|text)\b/.test(sql)) ended = true;
  };
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(options.indexerFiles ? options.indexerFiles(raw) : raw, db, {
    isOwnWrite: (p, sha) => app.wasWrittenByUs(p, sha),
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
    app, repo, db, queue,
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    async index() {
      await indexer.indexVaultFull();
      await queued;
    },
    /** One sync cycle in which the app ends right after the first merge base it writes. */
    async cycleEndingAfterTheBase() {
      armed = true;
      try {
        await worker.runCycle();
      } catch {
        // The cycle did not get further; that is the point.
      }
      armed = false;
      const didEnd = ended;
      ended = false;
      pulled.length = 0;
      return didEnd;
    },
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, bytes: number[]) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), new Uint8Array(bytes));
    },
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    async row(p: string) {
      return db.queryOne<Row>("SELECT local_sha256, base_sha256, base_etag, base_text, remote_etag FROM sync_state WHERE path = ?", [p]);
    },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav();
  return {
    dav,
    remoteBytes: (p: string) => [...dav.files.get(p)!.bytes],
    uploads: (p: string) => dav.log.filter((line) => line === `PUT ${p}`).length,
    /** The server gives the file a new ETag and nothing else (a migration, a re-scan). */
    restamp(p: string) { dav.files.get(p)!.etag = `restamped-${dav.log.length}`; },
  };
}

/** The text a row holds IS the version its hash names — or the row holds none. */
async function holdsOneVersion(row: Row | null): Promise<boolean> {
  if (!row || row.base_text === null) return true;
  return (await sha256(utf8(row.base_text))) === row.base_sha256;
}

describe("hash and text of the merge base are one write (Sammelplan § 3.102 no. 7)", () => {
  it("an upload: the app ends right after the base is written, and the row still names the version it holds", async () => {
    const w = world();
    const a = await device(w.dav);
    await a.put("Note.md", utf8("one\n"));
    await a.cycle();
    await a.put("Note.md", utf8("one\ntwo\n"));
    await a.index();
    expect(await a.cycleEndingAfterTheBase()).toBe(true);
    expect(w.remoteBytes("Note.md")).toEqual(utf8("one\ntwo\n"));
    expect(await holdsOneVersion(await a.row("Note.md"))).toBe(true);
  });

  it("a pull: the app ends right after the base is written, and the row still names the version it holds", async () => {
    const w = world();
    const a = await device(w.dav), b = await device(w.dav);
    await a.put("Note.md", utf8("one\n"));
    await a.cycle();
    await b.cycle();
    await a.put("Note.md", utf8("one\ntwo\n"));
    await a.cycle();
    expect(await b.cycleEndingAfterTheBase()).toBe(true);
    expect(await holdsOneVersion(await b.row("Note.md"))).toBe(true);
  });

  it("a pull of a file that another program saved in Windows-1252 elsewhere — byte for byte from here on", async () => {
    const w = world();
    const a = await device(w.dav), b = await device(w.dav);
    await a.put("Data.csv", utf8("id;name\r\n1;Grün\r\n"));
    await a.cycle();
    await b.cycle();
    expect((await b.row("Data.csv"))!.base_text).toBe("id;name\r\n1;Grün\r\n");
    await a.put("Data.csv", windows1252("id;name\r\n1;Grün\r\n"));
    await a.cycle();
    expect(await b.cycleEndingAfterTheBase()).toBe(true);
    expect(await holdsOneVersion(await b.row("Data.csv"))).toBe(true);
  });
});

describe("a streamed upload leaves no text of an earlier version (Sammelplan § 3.102 no. 2)", () => {
  class StreamingTarget implements ISyncTarget {
    public acceptsContentRef = true;
    async push(_op: SyncOperation) { return { etag: "etag-2" }; }
    async pull() { return { etagMap: new Map() }; }
    async download() { return new Uint8Array(); }
  }

  it("the hash moves on to the uploaded version, and the text of the version before goes with it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = await realSqlite();
    closers.push(() => db.close());
    const repo = new SyncStateRepository(db);
    const queue = new SyncQueue(db);
    const before = "the version before\n";
    await db.execute(
      "INSERT INTO sync_state (path, local_sha256, base_sha256, base_etag, remote_etag, base_text) VALUES (?, ?, ?, 'etag-1', 'etag-1', ?)",
      ["Huge.md", "local-now", await sha256(utf8(before)), before]);
    const ref: SyncContentRef = { rootId: "root", relPath: "Huge.md", size: 90 * 1024 * 1024, sha256: "f".repeat(64) };
    const files = { exists: async () => true, readBinaryFile: async () => { throw new Error("streamed: never read"); } };
    const engine = new SyncEngine(queue, new StreamingTarget(), files as unknown as IVaultAdapter, repo, async () => ref);
    await queue.queueWrite("Huge.md");
    await engine.processQueue();
    const row = await db.queryOne<Row>("SELECT local_sha256, base_sha256, base_etag, base_text, remote_etag FROM sync_state WHERE path = ?", ["Huge.md"]);
    expect(row!.base_sha256).toBe(ref.sha256);
    expect(row!.base_etag).toBe("etag-2");
    expect(row!.base_text).toBeNull();
    // The marker the upload started from moves on to what went up.
    expect(row!.local_sha256).toBe(ref.sha256);
  });
});

describe("a full index pass and a first upload that ends while it runs (Sammelplan § 3.102 no. 3)", () => {
  it("the pass leaves the base the upload recorded", async () => {
    const w = world();
    let upload: (() => Promise<void>) | null = null;
    // The pass has taken its look at the sync rows; while it reads the file,
    // the file's first upload ends — its base is the version it uploaded.
    const a = await device(w.dav, {
      indexerFiles: (raw) => new Proxy(raw, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (key !== "readBinaryFile" && key !== "readTextFile") return typeof value === "function" ? value.bind(target) : value;
          return async (p: string) => {
            if (p === "Note.md" && upload) {
              const run = upload;
              upload = null;
              await run();
            }
            return (value as (p: string) => Promise<unknown>).call(target, p);
          };
        },
      }),
    });
    const first = "first\n", later = "first\nchanged since\n";
    await a.put("Note.md", utf8(later));
    upload = async () => {
      await a.db.execute(
        `INSERT INTO sync_state (path, local_sha256, base_sha256, base_etag, remote_etag, base_text) VALUES (?, ?, ?, 'e1', 'e1', ?)
         ON CONFLICT(path) DO UPDATE SET local_sha256 = excluded.local_sha256, base_sha256 = excluded.base_sha256,
           base_etag = excluded.base_etag, remote_etag = excluded.remote_etag, base_text = excluded.base_text`,
        ["Note.md", await sha256(utf8(first)), await sha256(utf8(first)), first]);
    };
    await a.index();
    expect(upload).toBeNull();
    const row = (await a.row("Note.md"))!;
    expect(row.base_sha256).toBe(await sha256(utf8(first)));
    expect(row.base_text).toBe(first);
    expect(await holdsOneVersion(row)).toBe(true);
  });
});

describe("a file that travels byte for byte, changed here while the remote only got a new ETag (Sammelplan § 3.102 no. 6)", () => {
  const cases = [
    { name: "an image", p: "pic.png", first: [0x89, 0x50, 0x4e, 0x47, 1, 2, 3], changed: [0x89, 0x50, 0x4e, 0x47, 4, 5, 6, 7] },
    { name: "a .csv in Windows-1252", p: "Data.csv", first: windows1252("id;name\r\n1;Grün\r\n"), changed: windows1252("id;name\r\n1;Grün\r\n2;Weiß\r\n") },
  ];
  for (const c of cases) {
    it(`${c.name}: the change stays, goes up, and reaches the other device — no conflict copy`, async () => {
      const w = world();
      const a = await device(w.dav), b = await device(w.dav);
      await a.put(c.p, c.first);
      await a.cycle();
      await b.cycle();
      await b.put(c.p, c.changed);
      w.restamp(c.p);
      await b.cycle();
      expect(await b.files()).toEqual([c.p]);
      expect(await b.bytes(c.p)).toEqual(c.changed);
      expect(w.remoteBytes(c.p)).toEqual(c.changed);
      await a.cycle();
      expect(await a.bytes(c.p)).toEqual(c.changed);
      expect(await a.files()).toEqual([c.p]);
      expect((await b.row(c.p))!.base_sha256).toBe(await sha256(c.changed));
    });
  }

  it("a change on both sides is still a conflict copy", async () => {
    const w = world();
    const a = await device(w.dav), b = await device(w.dav);
    const first = [0x89, 0x50, 0x4e, 0x47, 1], mine = [0x89, 0x50, 0x4e, 0x47, 2], theirs = [0x89, 0x50, 0x4e, 0x47, 3];
    await a.put("pic.png", first);
    await a.cycle();
    await b.cycle();
    await a.put("pic.png", theirs);
    await a.cycle();
    await b.put("pic.png", mine);
    await b.cycle();
    expect(await b.bytes("pic.png")).toEqual(theirs);
    const copies = (await b.files()).filter((name) => name.includes(".CONFLICT-"));
    expect(copies).toHaveLength(1);
    expect(await b.bytes(copies[0])).toEqual(mine);
  });
});

describe("the class stays closed", () => {
  const source = (p: string) => fs.readFile(new URL(`../../src/${p}`, import.meta.url), "utf8");

  it("the sync records a merge base only in one statement, and the index never writes a text over one the sync recorded", async () => {
    for (const file of ["sync/SyncWorker.ts", "sync/SyncEngine.ts"]) {
      const code = await source(file);
      for (const call of ["updateBaseState(", "updateBaseText(", "clearBaseText(", "updateLocalHashAndBaseText("]) {
        expect(code.includes(call), `${file} writes part of a merge base: ${call}`).toBe(false);
      }
    }
    expect((await source("vault/VaultIndexer.ts")).includes("updateLocalHashAndBaseText("), "the index writes an unconditional base text").toBe(false);
  });
});
