import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEveryWrite, realSqlite } from "./helpers/realSqlite.js";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * A pass that fails after part of its writes (finding 2026-10-12).
 *
 * A pass says what it found — a file that went, a new one, one changed
 * elsewhere — once its transaction is through; the host queues uploads and
 * remote deletions from that. A transaction that fails is rolled back, wrote
 * nothing and has nothing to say; a full scan in several short transactions
 * (performance plan L4) says what the ones that went through wrote.
 *
 * The desktop's database adapter used to hold no transaction (a pool; every
 * call may get another connection): `transaction()` only kept a second one
 * out, every statement committed as it ran, and a scan that failed after a
 * batch had to say what that batch had written (`keepsWhatAFailedTransactionWrote`).
 * Its transactions are real since stability plan R1, on a connection Rust
 * holds for each; the model below gives the real SQLite the desktop's shape
 * (the scan's batches through the body's handle, counted, and one of them
 * refused), and both shells answer the same.
 *
 * Real files, a real SQLite. Nothing here depends on the order a folder is
 * listed in.
 */

/**
 * `TauriDatabaseAdapter` since R1: a real transaction, a batch from its body
 * running in it (`db_tx_batch`), a batch of its own a transaction of its own
 * (`db_batch`). `refuseBatch` names the batch (counted over the adapter's
 * life) that the database refuses — a disk that is full, a lock that is not
 * let go. `flush` is where every batch goes; a test may step in there.
 */
type DesktopLike = IDatabaseAdapter & {
  batches: number;
  refuseBatch?: number;
  flush: (statements: BatchStatement[], tx: SqlStatements | null) => Promise<void>;
};
function desktopLike(inner: IDatabaseAdapter): DesktopLike {
  const db: DesktopLike = {
    ...inner,
    batches: 0,
    async flush(statements, tx) {
      if (statements.length === 0) return;
      if (db.batches + 1 === db.refuseBatch) throw new Error("disk full");
      const run = async (on: SqlStatements) => {
        for (const st of statements) await on.execute(st.sql, st.params ?? []);
      };
      if (tx) await run(tx);
      else await inner.transaction(run);
      db.batches += 1;
    },
    transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
      return inner.transaction((tx) => fn({ ...tx, runBatch: (statements) => db.flush(statements, tx) }));
    },
    runBatch: (statements: BatchStatement[]) => db.flush(statements, null),
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

/** Five notes a batch: the scan's batches are the same at forty statements as at its four thousand. */
const BATCH = 40;

const hooks = (scanTransactionMs = Number.POSITIVE_INFINITY) => ({
  scanBatchStatements: BATCH,
  // These scenes count the scan's batches of statements: in ONE transaction,
  // so that the count does not depend on the clock. A scan in several short
  // transactions fails the same way: vault-indexer-short-transactions.test.ts.
  // The scenes of an index owed a scan pass 0: a transaction per file, so
  // that a refused batch is one transaction and the ones before it stay.
  scanTransactionMs,
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
  // Every write: one sent to the adapter, and one through a transaction's handle (D3).
  return beforeEveryWrite(db, (_sql, params) => {
    if (params.includes(file)) throw new Error("disk full");
  });
}

const VANISHED = ["Gone 1.md", "Gone 2.csv"];
const CHANGED = "# Known\n\nchanged elsewhere\n";
/** Eight statements a note; the scan hands its writes over once it holds `BATCH`. */
const note = (i: number) => `---\nstatus: open\n---\n# Note ${i}\n\n#tagged, see [[n0001]]\n`;
const name = (i: number) => `n${String(i).padStart(4, "0")}.md`;
// More notes than one batch holds, a few batches' worth. It was 560 against
// the scan's own 4000: real files and a real SQLite, and under a loaded commit
// hook a test ran into the 20 s limit (Sammelplan § 3.142 Nr. 1).
const NOTES = 24;
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

  it("the desktop's database takes back what was handed over (R1): the scan says nothing, and the next one says everything", async () => {
    const db = desktopLike(sqlite);
    const { indexer } = await scene(db);
    const before = db.batches;
    // The scan hands over a first batch, and the database refuses the second.
    db.refuseBatch = before + 2;

    await expect(indexer.indexVaultFull("return to the app")).rejects.toThrow("disk full");
    expect(db.batches, "the scene: a batch went through before the scan failed").toBe(before + 1);
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
    expect(foreign).toEqual([]);
    await expectToldWhatTheIndexHolds(db);

    db.refuseBatch = undefined;
    await indexer.indexVaultFull("return to the app");
    expect([...gone].sort()).toEqual(VANISHED);
    expect(foreign).toEqual(["Known.md"]);
    expect([...fresh].sort()).toEqual(Array.from({ length: NOTES }, (_, i) => name(i + 1)));
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

  it("the desktop's database takes back what ran (R1): nothing is said, and the next re-read says it all", async () => {
    const db = desktopLike(sqlite);
    const { indexer, last } = await scene(db);
    const restore = refuseEveryWriteOf(db, last);

    await expect(indexer.reconcileFolder("Folder")).rejects.toThrow("disk full");
    restore();
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
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
  // "Whole" is a mark a scan that went through writes; never the absence of
  // "owed" (third review of 11.11.). Each kill point of a first scan leaves an
  // index that is not whole, whatever saves wrote into it meanwhile.
  const marks = async (db: IDatabaseAdapter) =>
    (await db.query<{ key: string }>(`SELECT key FROM meta WHERE key IN ('index_scan_owed', 'index_scan_whole') AND value = '1' ORDER BY key`)).map((r) => r.key);

  it("a first scan called off during its walk leaves an index that is not whole, a save's row in it notwithstanding", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const leaving = new AbortController();
    const indexer = new VaultIndexer(vault, sqlite, { ...hooks(), scanSignal: leaving.signal });
    const list = vault.listDir.bind(vault);
    vault.listDir = async (...args) => {
      // During the walk a note is saved (quick capture, a journal entry), and the vault is closed.
      await new VaultIndexer(vault, sqlite, hooks()).indexFile(await vault.getFileInfo(name(1)));
      leaving.abort();
      return list(...args);
    };
    await expect(indexer.indexVaultFull("open, empty index")).rejects.toThrow();
    expect((await sqlite.query<{ path: string }>("SELECT path FROM files")).map((r) => r.path)).toEqual([name(1)]);
    // The next open, a new indexer on the same index.
    expect(await new VaultIndexer(vault, sqlite, hooks()).indexComplete()).toBe(false);
    expect(await marks(sqlite)).toEqual(["index_scan_owed"]);
  });

  it("a process that ends during the first scan's walk, before its first rows, leaves an index that is not whole", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, sqlite, hooks());
    const atTheKill: { complete?: boolean; marks?: string[] } = {};
    let killed!: () => void;
    const kill = new Promise<void>((resolve) => { killed = resolve; });
    vault.listDir = async () => {
      // A save writes a row; then the process ends: nothing after this line runs.
      await new VaultIndexer(vault, sqlite, hooks()).indexFile(await vault.getFileInfo(name(2)));
      atTheKill.complete = await new VaultIndexer(vault, sqlite, hooks()).indexComplete();
      atTheKill.marks = await marks(sqlite);
      killed();
      return new Promise(() => {});
    };
    void indexer.indexVaultFull("open, empty index");
    await kill;
    expect(atTheKill).toEqual({ complete: false, marks: ["index_scan_owed"] });
  });

  it("a scan that could not list a folder goes through, and the index is not whole: what it did not see is unknown (fourth review of 11.11.)", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    await vault.createDir("Shared");
    await vault.writeTextFile("Shared/Target.md", "# Target\n");
    const indexer = new VaultIndexer(vault, sqlite, hooks());
    // A network share, a provider's folder that does not answer: listed as unreadable.
    const list = vault.listDir.bind(vault);
    (vault as unknown as { listDirReport: unknown }).listDirReport = async (p: string, recursive: boolean) => ({
      files: (await list(p, recursive)).filter((f) => !f.path.startsWith("Shared")),
      skipped: [{ path: "Shared", reason: "unreadable" }],
    });
    const report = await indexer.indexVaultFull("open, empty index");
    expect(report.whole).toBe(false);
    expect(report.skipped).toEqual([{ path: "Shared", reason: "unreadable" }]);
    // Through for the first uploads (issue 125), not whole for what plans a write.
    expect(await indexer.indexComplete()).toBe(true);
    expect(await indexer.indexWhole()).toBe(false);
    // Readable again: the next scan makes it whole.
    delete (vault as unknown as { listDirReport?: unknown }).listDirReport;
    expect((await indexer.indexVaultFull("open")).whole).toBe(true);
    expect(await indexer.indexWhole()).toBe(true);
  });

  it("…nor where a single file could not be read", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, sqlite, hooks());
    // Refused as a permission is: every way the indexer reads a file says no.
    const refuse = (p: string) => Object.assign(new Error(`Access is denied: ${p}`), { code: "PERMISSION_DENIED" });
    const readText = vault.readTextFile.bind(vault);
    vault.readTextFile = async (p) => { if (p === name(2)) throw refuse(p); return readText(p); };
    const readBinary = vault.readBinaryFile.bind(vault);
    vault.readBinaryFile = async (p) => { if (p === name(2)) throw refuse(p); return readBinary(p); };
    const report = await indexer.indexVaultFull("open, empty index");
    expect(report.whole).toBe(false);
    expect(report.skipped.map((s) => s.path)).toEqual([name(2)]);
    expect(await indexer.indexWhole()).toBe(false);
    // And an unchanged scan after it does not make it whole either.
    expect((await indexer.indexVaultFull("open")).whole).toBe(false);
    expect(await indexer.indexWhole()).toBe(false);
  });

  it("a rebuild called off half way leaves an index that is neither complete nor whole", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, sqlite, hooks());
    await indexer.indexVaultFull("open, empty index");
    expect(await indexer.indexWhole()).toBe(true);
    // The scan that follows the reset fails: every row is marked to be read again.
    vault.listDir = async () => { throw new Error("the share dropped"); };
    await expect(indexer.rebuildIndex()).rejects.toThrow("the share dropped");
    expect(await indexer.indexComplete()).toBe(false);
    expect(await indexer.indexWhole()).toBe(false);
  });

  it("an index without the mark — left by a build up to 0.8.7 — is not whole until a full scan went through on it", async () => {
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, sqlite, hooks());
    await indexer.indexVaultFull("open, empty index");
    expect(await marks(sqlite)).toEqual(["index_scan_whole"]);
    expect(await indexer.indexComplete()).toBe(true);
    // What an older build leaves: rows, and no mark either way.
    await sqlite.execute(`DELETE FROM meta WHERE key IN ('index_scan_owed', 'index_scan_whole', 'index_scan_through')`);
    expect(await indexer.indexComplete()).toBe(false);
    // The warm scan of the next open is its build, and says so when it went through.
    await indexer.indexVaultFull("open");
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("is owed one while its first scan has not gone through — the rows that scan kept do not make it whole", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= NOTES; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks(0));
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
    const indexer = new VaultIndexer(vault, db, hooks(0));
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
    const flush = db.flush;
    let ended!: () => void;
    const end = new Promise<void>((resolve) => { ended = resolve; });
    db.flush = async (statements, tx) => {
      if (db.batches === 1) { ended(); return new Promise<void>(() => {}); }
      return flush(statements, tx);
    };
    void new VaultIndexer(vault, db, hooks(0)).indexVaultFull("open, empty index");
    await end;
    // The next start finds the rows of the first batch, and no scan that went through.
    expect((await sqlite.query<{ path: string }>("SELECT path FROM files")).length).toBeGreaterThan(0);
    expect(await new VaultIndexer(vault, sqlite, hooks(0)).indexComplete()).toBe(false);
  });

  it("is owed one when a small first scan fails in its only batch — a note saved afterwards does not make it whole", async () => {
    const db = desktopLike(sqlite);
    for (let i = 1; i <= 3; i++) await vault.writeTextFile(name(i), note(i));
    const indexer = new VaultIndexer(vault, db, hooks(0));
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
    const indexer = new VaultIndexer(vault, db, hooks(0));
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
    const indexer = new VaultIndexer(vault, db, { ...hooks(0), onFullScanFailed: (info) => void failed.push(info.error) });
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
    const indexer = new VaultIndexer(vault, db, hooks(0));
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
