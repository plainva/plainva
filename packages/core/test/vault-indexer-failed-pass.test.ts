import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { BatchStatement, IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * A pass that fails after part of its writes (finding 2026-10-12).
 *
 * A pass says what it found — a file that went, a new one, one changed
 * elsewhere — once its transaction is through; the host queues uploads and
 * remote deletions from that. On the phone the transaction is one: a pass
 * that fails is rolled back, wrote nothing and has nothing to say.
 *
 * The desktop's database adapter cannot hold a transaction (a pool; every
 * call may get another connection). There `transaction()` only keeps a second
 * one out, every statement is committed as it runs, and a full scan hands its
 * writes over in batches of some thousand statements, each batch a native
 * transaction of its own. A scan that fails later — a file that vanished
 * between the listing and its read is enough — has written what it had
 * handed over, and said nothing:
 *  - the rows of the files that went were in the first batch. Gone from the
 *    index, never reported: the sync rows stay, no remote deletion is queued,
 *    and the next scan no longer knows the paths. The files stay on the
 *    remote and on every other device;
 *  - the files of the batches that got through are indexed and were never
 *    announced: a new one waits for the sweep of the next sync start, a
 *    change made by another program is not uploaded at all — the next scan
 *    finds the file as it indexed it.
 *
 * Real files, a real SQLite; the wrapper below gives it the desktop's manners.
 * Nothing here depends on the order a folder is listed in.
 */

/**
 * `TauriDatabaseAdapter`: a turn instead of a transaction, each statement
 * committed as it runs, `runBatch` atomic on its own. `refuseBatch` names the
 * batch (counted over the adapter's life) that the database refuses — a disk
 * that is full, a lock that is not let go.
 */
function desktopLike(inner: IDatabaseAdapter): IDatabaseAdapter & { batches: number; refuseBatch?: number } {
  let last: Promise<unknown> = Promise.resolve();
  const db: IDatabaseAdapter & { batches: number; refuseBatch?: number } = {
    ...inner,
    batches: 0,
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const run = last.then(() => fn());
      last = run.catch(() => undefined);
      return run;
    },
    async runBatch(statements: BatchStatement[]): Promise<void> {
      if (statements.length === 0) return;
      if (db.batches + 1 === db.refuseBatch) throw new Error("disk full");
      await inner.transaction(async () => {
        for (const s of statements) await inner.execute(s.sql, s.params ?? []);
      });
      db.batches += 1;
    },
    keepsWhatAFailedTransactionWrote: true,
  };
  return db;
}

const sha = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

let root: string;
let vault: LocalVaultAdapter;
let sqlite: IDatabaseAdapter;
let fresh: string[];
let foreign: string[];
let gone: string[];

const hooks = () => ({
  onNewLocalFile: (p: string) => void fresh.push(p),
  onExternalModification: (p: string) => void foreign.push(p),
  onLocalFileDeleted: (p: string) => void gone.push(p),
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-failed-pass-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  sqlite = await realSqlite();
  fresh = [];
  foreign = [];
  gone = [];
});

afterEach(async () => {
  await sqlite.close();
  await fs.rm(root, { recursive: true, force: true });
});

const onDisk = (p: string) => path.join(root, p);

/**
 * Refuses every statement that writes for `file`, until the returned function
 * is called. (A file that cannot be READ no longer ends a pass over many: it is
 * left out and named, issue #125 — vault-indexer-unreadable-entry.test.ts.)
 */
function refuseEveryWriteOf(db: IDatabaseAdapter, file: string): () => void {
  const execute = db.execute.bind(db);
  db.execute = async (sql, params) => {
    if (Array.isArray(params) && params.includes(file)) throw new Error("disk full");
    return execute(sql, params);
  };
  return () => { db.execute = execute; };
}

const VANISHED = ["Gone 1.md", "Gone 2.csv"];
const CHANGED = "# Known\n\nchanged elsewhere\n";
/** Eight statements a note; the scan hands its writes over once it holds 4000. */
const note = (i: number) => `---\nstatus: open\n---\n# Note ${i}\n\n#tagged, see [[n0001]]\n`;
const name = (i: number) => `n${String(i).padStart(4, "0")}.md`;
const NOTES = 560;
const isNew = (p: string) => /^(?:Folder\/)?n\d{4}\.md$/.test(p);

/**
 * What the host must have heard of once a pass is over, whatever became of
 * the pass: exactly what the index now holds differently from before it.
 */
async function expectToldWhatTheIndexHolds(db: IDatabaseAdapter): Promise<void> {
  const rows = new Map(
    (await db.query<{ path: string; sha256: string }>("SELECT path, sha256 FROM files")).map((r) => [r.path, r.sha256]),
  );
  expect([...gone].sort(), "the files that went and whose rows are gone").toEqual(VANISHED.filter((p) => !rows.has(p)));
  expect([...fresh].sort(), "the new files that are indexed").toEqual([...rows.keys()].filter(isNew).sort());
  expect(foreign, "the file another program changed, once it is indexed as changed")
    .toEqual(rows.get("Known.md") === (await sha(CHANGED)) ? ["Known.md"] : []);
}

describe("a full scan that fails after part of its writes", () => {
  /** Two files that went, one that another program changed, and more new notes than one batch holds. */
  async function scene(db: IDatabaseAdapter): Promise<{ indexer: VaultIndexer; last: string }> {
    const indexer = new VaultIndexer(vault, db, hooks());
    await vault.writeTextFile("Gone 1.md", "# Gone 1\n");
    await vault.writeTextFile("Gone 2.csv", "id;name\n");
    await vault.writeTextFile("Known.md", "# Known\n");
    await indexer.indexVaultFull("open, empty index");
    fresh.length = 0;

    for (const p of VANISHED) await fs.rm(onDisk(p));
    await fs.writeFile(onDisk("Known.md"), CHANGED, "utf8");
    await fs.utimes(onDisk("Known.md"), new Date(), new Date(Date.now() + 5000));
    for (let i = 1; i <= NOTES; i++) await fs.writeFile(onDisk(name(i)), note(i), "utf8");
    // The notes are read in the order the folder is listed in.
    const order = (await vault.listDir("", true)).filter((f) => !f.isDirectory && f.name.endsWith(".md")).map((f) => f.path);
    return { indexer, last: order[order.length - 1] };
  }

  it("the desktop's database keeps what was handed over: the scan says so before it passes the failure on", async () => {
    const db = desktopLike(sqlite);
    const { indexer } = await scene(db);
    const before = db.batches;
    // The scan hands over a first batch, and the database refuses the second.
    db.refuseBatch = before + 2;

    await expect(indexer.indexVaultFull("return to the app")).rejects.toThrow("disk full");
    expect(db.batches, "the scene: a batch went through before the scan failed").toBe(before + 1);
    await expectToldWhatTheIndexHolds(db);
    expect(fresh.length, "the scene: the batch that went through held new notes").toBeGreaterThan(0);

    // The next scan reads the rest and says the rest: every file once.
    db.refuseBatch = undefined;
    await indexer.indexVaultFull("return to the app");
    expect([...gone].sort()).toEqual(VANISHED);
    expect(foreign).toEqual(["Known.md"]);
    expect([...fresh].sort()).toEqual(Array.from({ length: NOTES }, (_, i) => name(i + 1)));
  });

  it("…and a scan whose first batch is refused has written nothing and says nothing", async () => {
    const db = desktopLike(sqlite);
    const { indexer } = await scene(db);
    const before = db.batches;
    db.refuseBatch = before + 1;

    await expect(indexer.indexVaultFull("return to the app")).rejects.toThrow("disk full");
    expect(db.batches).toBe(before);
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
    expect(foreign).toEqual([]);
    await expectToldWhatTheIndexHolds(db);

    db.refuseBatch = undefined;
    await indexer.indexVaultFull("return to the app");
    expect([...gone].sort()).toEqual(VANISHED);
    expect(foreign).toEqual(["Known.md"]);
    expect(fresh).toHaveLength(NOTES);
  });

  it("where the transaction is one (the phone), the failed scan is rolled back as a whole and the next one says everything", async () => {
    const { indexer, last } = await scene(sqlite);
    const restore = refuseEveryWriteOf(sqlite, last);

    await expect(indexer.indexVaultFull("return to the app")).rejects.toThrow("disk full");
    restore();
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
    expect(foreign).toEqual([]);
    await expectToldWhatTheIndexHolds(sqlite);

    await indexer.indexVaultFull("return to the app");
    expect([...gone].sort()).toEqual(VANISHED);
    expect(foreign).toEqual(["Known.md"]);
    expect(fresh).toHaveLength(NOTES);
  });
});

describe("a folder re-read that fails after part of its writes", () => {
  async function scene(db: IDatabaseAdapter): Promise<{ indexer: VaultIndexer; last: string }> {
    const indexer = new VaultIndexer(vault, db, hooks());
    await vault.writeTextFile("Folder/Gone 1.md", "# Gone 1\n");
    await vault.writeTextFile("Folder/Known.md", "# Known\n");
    await indexer.indexVaultFull("open, empty index");
    fresh.length = 0;

    await fs.rm(onDisk("Folder/Gone 1.md"));
    for (let i = 1; i <= 3; i++) await fs.writeFile(onDisk(`Folder/${name(i)}`), note(i), "utf8");
    const order = (await vault.listDir("Folder", true)).filter((f) => !f.isDirectory).map((f) => f.path);
    // The file the re-read writes last: the other new ones are written by then.
    return { indexer, last: order.filter(isNew).at(-1)! };
  }
  const told = async (db: IDatabaseAdapter) => {
    const rows = (await db.query<{ path: string }>("SELECT path FROM files")).map((r) => r.path);
    expect(gone, "the file that went, once its row is gone").toEqual(rows.includes("Folder/Gone 1.md") ? [] : ["Folder/Gone 1.md"]);
    expect([...fresh].sort(), "the new files that are indexed").toEqual(rows.filter(isNew).sort());
  };

  it("the desktop's database keeps what ran: the re-read says so before it passes the failure on", async () => {
    const db = desktopLike(sqlite);
    const { indexer, last } = await scene(db);
    const restore = refuseEveryWriteOf(db, last);

    await expect(indexer.reconcileFolder("Folder")).rejects.toThrow("disk full");
    restore();
    expect((await db.query("SELECT path FROM files")).length, "the scene: the re-read had written before it failed").not.toBe(2);
    await told(db);

    await indexer.reconcileFolder("Folder");
    expect(gone).toEqual(["Folder/Gone 1.md"]);
    expect([...fresh].sort()).toEqual([1, 2, 3].map((i) => `Folder/${name(i)}`));
  });

  it("where the transaction is one (the phone), nothing was written and nothing is said", async () => {
    const { indexer, last } = await scene(sqlite);
    const restore = refuseEveryWriteOf(sqlite, last);

    await expect(indexer.reconcileFolder("Folder")).rejects.toThrow("disk full");
    restore();
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
    await told(sqlite);

    await indexer.reconcileFolder("Folder");
    expect(gone).toEqual(["Folder/Gone 1.md"]);
    expect(fresh).toHaveLength(3);
  });
});

describe("an index owed a full scan (issue 125)", () => {
  it("is owed one while its first scan has not gone through — the rows that scan kept do not make it whole", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks());
    // The first scan's second batch is refused: the first one stays written.
    db.refuseBatch = 2;
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow("disk full");
    expect((await db.query<{ path: string }>("SELECT path FROM files")).length).toBeGreaterThan(0);
    expect(await indexer.indexComplete()).toBe(false);

    db.refuseBatch = undefined;
    await indexer.indexVaultFull("open");
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("is owed one again once it was empty, and an unchanged scan writes nothing for it", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks());
    await indexer.indexVaultFull("open, empty index");
    expect(await indexer.indexComplete()).toBe(true);

    // Nothing changed: the scan writes not a single statement.
    const execute = db.execute.bind(db);
    let writes = 0;
    db.execute = async (sql, params) => { writes += 1; return execute(sql, params); };
    const batches = db.batches;
    await indexer.indexVaultFull("automatic refresh");
    expect(writes).toBe(0);
    expect(db.batches).toBe(batches);
    db.execute = execute;

    // Emptied again, and the next first scan fails after its first batch.
    await sqlite.execute("DELETE FROM files");
    db.refuseBatch = db.batches + 2;
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow("disk full");
    expect(await indexer.indexComplete()).toBe(false);
  });

  it("is owed one when the first scan ends after a batch without ever failing — the app was closed", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    // The second batch never comes back: the process ended while it ran.
    const runBatch = db.runBatch!.bind(db);
    let ended!: () => void;
    const end = new Promise<void>((resolve) => { ended = resolve; });
    db.runBatch = async (statements) => {
      if (db.batches === 1) { ended(); return new Promise<void>(() => {}); }
      return runBatch(statements);
    };
    void new VaultIndexer(vault, db, hooks()).indexVaultFull("open, empty index");
    await end;
    // The next start finds the rows of the first batch, and no scan that went through.
    expect((await sqlite.query<{ path: string }>("SELECT path FROM files")).length).toBeGreaterThan(0);
    expect(await new VaultIndexer(vault, sqlite, hooks()).indexComplete()).toBe(false);
  });

  it("is owed one when a small first scan fails in its only batch — a note saved afterwards does not make it whole", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= 3; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks());
    // A few notes fit into the tail: refused, it was the scan's only batch.
    db.refuseBatch = 1;
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow("disk full");
    expect(await db.query("SELECT path FROM files")).toHaveLength(0);
    // The vault opens all the same, and a save writes its row.
    db.refuseBatch = undefined;
    await indexer.indexFile(await vault.getFileInfo(name(1)));
    expect(await db.query("SELECT path FROM files")).toHaveLength(1);
    expect(await indexer.indexComplete()).toBe(false);

    await indexer.indexVaultFull("open");
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("stays whole through a scan that writes and one that fails, once a scan went through on it", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= 3; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks());
    await indexer.indexVaultFull("open, empty index");
    expect(await indexer.indexComplete()).toBe(true);

    await fs.writeFile(onDisk(name(1)), "# changed elsewhere\n");
    await fs.utimes(onDisk(name(1)), new Date(), new Date(Date.now() + 5000));
    const batches = db.batches;
    await indexer.indexVaultFull("automatic refresh");
    expect(db.batches).toBeGreaterThan(batches);
    expect(await indexer.indexComplete()).toBe(true);

    await fs.writeFile(onDisk(name(2)), "# changed again\n");
    await fs.utimes(onDisk(name(2)), new Date(), new Date(Date.now() + 9000));
    db.refuseBatch = db.batches + 1;
    await expect(indexer.indexVaultFull("automatic refresh")).rejects.toThrow("disk full");
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("passes on what stopped the first scan, not what stopped the mark", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= 3; i++) await vault.writeTextFile(name(i), note(i));
    const failed: unknown[] = [];
    const indexer = new VaultIndexer(vault, db, { ...hooks(), onFullScanFailed: (info) => void failed.push(info.error) });
    db.refuseBatch = 1;
    const execute = db.execute.bind(db);
    db.execute = async (sql, params) => {
      if (/^INSERT OR REPLACE INTO meta/.test(sql)) throw new Error("database is locked");
      return execute(sql, params);
    };
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow("disk full");
    expect(failed.map((e) => (e as Error).message)).toEqual(["disk full"]);
  });

  it("is owed one when the first scan's walk fails, and whole after a scan that found nothing left to write", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= 3; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks());
    const listDir = vault.listDir.bind(vault);
    vault.listDir = async () => { throw new Error("folder not mounted"); };
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow("folder not mounted");
    vault.listDir = listDir;
    // Every note gets its row through the single path: saves, the watcher.
    for (let i = 1; i <= 3; i++) await indexer.indexFile(await vault.getFileInfo(name(i)));
    expect(await indexer.indexComplete()).toBe(false);

    // The scan that follows has nothing to write, and it went through.
    const batches = db.batches;
    await indexer.indexVaultFull("open");
    expect(db.batches).toBe(batches);
    expect(await indexer.indexComplete()).toBe(true);
  });
});
