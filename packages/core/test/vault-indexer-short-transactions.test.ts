import { describe, expect, it } from "vitest";
import { beforeEveryWrite, realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer, type VaultIndexerOptions } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";

/**
 * A full scan writes in short transactions (performance plan L4, Sammelplan
 * § 3.179 no. 1).
 *
 * It used to hold ONE transaction from its first read to its last write. The
 * phone's database is one connection whose transactions take turns, and so
 * are the desktop's: a save, the sync worker and every write from elsewhere
 * waited behind the scan - up to a minute on a large vault. Now each
 * transaction reads and writes for `scanTransactionMs` and the others get
 * their turn in between. What must hold:
 *  - a write from elsewhere runs while the scan is under way, not after it;
 *  - a scan cut off between two transactions leaves an index the next scan
 *    completes - row for row the index one scan in one go writes;
 *  - a note saved and indexed between two transactions is read again by the
 *    scan, not overwritten with an older reading or taken for a foreign change;
 *  - what a committed transaction found survives an app that is ended before
 *    the scan tells the host: a foreign change is marked `local_ahead` in its
 *    own transaction, and the sync's sweep queues it at the next start;
 *  - a path the app renamed away is not reported gone, also when the scan has
 *    read the moved file again.
 */

/**
 * The same database with the manners of both shells' adapters: a second
 * transaction waits for the first. `endAfter(n)`: the app is ended once `n`
 * transactions went through - every later one never starts and never
 * returns, so the scan reaches neither its end nor its `catch`.
 */
function takingTurns(inner: IDatabaseAdapter): IDatabaseAdapter & { transactions: number; endAfter(n: number): Promise<void> } {
  let last: Promise<unknown> = Promise.resolve();
  let limit = Number.POSITIVE_INFINITY;
  let ended: () => void = () => {};
  const db = {
    ...inner,
    transactions: 0,
    endAfter(n: number) {
      limit = n;
      return new Promise<void>((resolve) => { ended = resolve; });
    },
    transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
      db.transactions += 1;
      if (db.transactions > limit) {
        ended();
        return new Promise<T>(() => {});
      }
      const run = last.then(() => inner.transaction(fn));
      last = run.catch(() => undefined);
      return run;
    },
  };
  return db;
}

/** A vault indexed and synced once: every file has a sync state the remote confirmed. */
async function syncedOnce(vault: MemoryVaultAdapter, db: IDatabaseAdapter): Promise<void> {
  await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
  await db.execute(`UPDATE sync_state SET remote_etag = 'etag-1', base_sha256 = local_sha256`);
  await db.execute(`UPDATE files SET sync_state = 'synced'`);
}

const queued = async (db: IDatabaseAdapter, operation = "write") =>
  (await db.query<{ file_path: string }>(`SELECT file_path FROM offline_queue WHERE operation = ? ORDER BY file_path`, [operation])).map((r) => r.file_path);

const NOTES = 40;
const names = Array.from({ length: NOTES }, (_, i) => `notes/n${String(i).padStart(2, "0")}.md`);

async function vaultWithNotes(): Promise<MemoryVaultAdapter> {
  const vault = new MemoryVaultAdapter(1_700_000_000_000);
  await vault.initialize();
  for (const [i, name] of names.entries()) {
    await vault.writeTextFile(name, `---\ntitle: Note ${i}\nstatus: open\n---\n# Note ${i}\nSee [[n${String((i + 1) % NOTES).padStart(2, "0")}]] #tag${i % 3}\n- [ ] task ${i}\n`);
  }
  await vault.writeBinaryFile("pictures/a.png", new Uint8Array([1, 2, 3]));
  await vault.writeBinaryFile("pictures/b.png", new Uint8Array([4, 5, 6]));
  return vault;
}

/** Every row of the index's own tables, in a stable order. */
async function dump(db: IDatabaseAdapter): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of ["files", "links", "tags", "properties", "sync_state", "meta", "offline_queue", "fts_notes"]) {
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`).catch(() => null);
    if (!rows) continue;
    out[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

async function indexInOneGo(vault: MemoryVaultAdapter): Promise<Record<string, unknown[]>> {
  const db = takingTurns(await realSqlite());
  await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
  expect(db.transactions).toBe(1);
  return dump(db);
}

describe("a full scan in short transactions", () => {
  it("lets a write from elsewhere through while it runs", async () => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    let scanDone = false;
    let writeDoneDuringScan: boolean | null = null;
    let asked = false;
    const options: VaultIndexerOptions = {
      scanTransactionMs: 0,
      onProgress: (current) => {
        if (current !== 5 || asked) return;
        asked = true;
        // What a save or the sync worker sends: a transaction of its own.
        void db.transaction(async (tx) => {
          await tx.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', '1')`);
        }).then(() => { writeDoneDuringScan = !scanDone; });
      },
    };
    await new VaultIndexer(vault, db, options).indexVaultFull();
    scanDone = true;
    await new Promise((r) => setTimeout(r, 0));
    expect(writeDoneDuringScan).toBe(true);
    // One file per transaction here: the scan let go between every two.
    expect(db.transactions).toBeGreaterThan(NOTES);
    expect(await db.queryOne(`SELECT value FROM meta WHERE key = 'probe'`)).toEqual({ value: "1" });
  });

  it("cut off between two transactions, leaves an index the next scan completes", async () => {
    const vault = await vaultWithNotes();
    const reference = await indexInOneGo(vault);

    const db = takingTurns(await realSqlite());
    const leaving = new AbortController();
    const first = new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      scanSignal: leaving.signal,
      onProgress: (current) => { if (current === 21) leaving.abort(); },
    });
    await expect(first.indexVaultFull()).rejects.toThrow();
    const partial = await db.query<{ path: string }>(`SELECT path FROM files`);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(NOTES);
    // The index began empty and owes a whole scan until one gets through.
    expect(await db.queryOne(`SELECT value FROM meta WHERE key = 'index_scan_owed'`)).toEqual({ value: "1" });

    await new VaultIndexer(vault, db, { scanTransactionMs: 0 }).indexVaultFull();
    expect(await dump(db)).toEqual(reference);
  });

  it("reads a note saved between two of its transactions again", async () => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    const foreign: string[] = [];
    const late = names[NOTES - 1];
    let saved = false;
    const indexer: VaultIndexer = new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      onExternalModification: (path) => foreign.push(path),
      onProgress: (current) => {
        if (current !== 3 || saved) return;
        saved = true;
        // A save of a note the scan has not reached: written and indexed in a turn of its own.
        void (async () => {
          await vault.writeTextFile(late, "# Saved\nwhile the scan ran\n");
          await indexer.indexFile(await vault.getFileInfo(late));
        })();
      },
    });
    await indexer.indexVaultFull();
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [late]);
    expect(row?.content).toContain("while the scan ran");
    expect(foreign).not.toContain(late);
  });

  it("fails in a later transaction: what the ones before committed stays and is said, the next scan says the rest", async () => {
    const vault = await vaultWithNotes();
    const inner = await realSqlite();
    const db = takingTurns(inner);
    const fresh: string[] = [];
    const last = names[NOTES - 1];
    const restore = beforeEveryWrite(inner, (_sql, params) => {
      if (params.includes(last)) throw new Error("disk full");
    });
    const indexer = new VaultIndexer(vault, db, { scanTransactionMs: 0, onNewLocalFile: (p) => fresh.push(p) });
    await expect(indexer.indexVaultFull()).rejects.toThrow("disk full");
    restore();
    const rows = (await db.query<{ path: string }>(`SELECT path FROM files`)).map((r) => r.path).sort();
    // Every committed file and nothing else was announced (its upload is queued).
    expect(rows.length).toBeGreaterThan(0);
    expect([...fresh].sort()).toEqual(rows);
    expect(rows).not.toContain(last);

    await indexer.indexVaultFull();
    expect(new Set(fresh).size).toBe(fresh.length);
    expect([...fresh].sort()).toEqual([...names, "pictures/a.png", "pictures/b.png"].sort());
  });

  it("a foreign change a committed transaction found reaches the sync after the app was ended mid-scan", async () => {
    const vault = await vaultWithNotes();
    const inner = await realSqlite();
    const db = takingTurns(inner);
    await syncedOnce(vault, db);
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged in another app\n`);

    // The app is ended after five transactions of the scan: no catch, no flush.
    const foreign: string[] = [];
    const ended = db.endAfter(db.transactions + 5);
    void new VaultIndexer(vault, db, { scanTransactionMs: 0, onExternalModification: (p) => foreign.push(p) }).indexVaultFull();
    await ended;
    expect(foreign).toEqual([]);
    const committed = (await db.query<{ path: string }>(`SELECT path FROM files WHERE sync_state = 'local_ahead' ORDER BY path`)).map((r) => r.path);
    expect(committed.length).toBe(5);

    // The next start: a new handle on the same rows. Its scan skips what the
    // ended one wrote (the timestamps match), and the sync's sweep after its
    // first pull queues every change that was found.
    const next = takingTurns(inner);
    await new VaultIndexer(vault, next, { scanTransactionMs: 0 }).indexVaultFull();
    await new SyncQueue(next).enqueueLocalOnlyFiles();
    expect(await queued(next)).toEqual([...names].sort());
  });

  it("fails in a later transaction: the foreign changes the ones before committed are said, the next scan says the rest", async () => {
    const vault = await vaultWithNotes();
    const inner = await realSqlite();
    const db = takingTurns(inner);
    await syncedOnce(vault, db);
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged in another app\n`);
    const foreign: string[] = [];
    const last = names[NOTES - 1];
    const restore = beforeEveryWrite(inner, (_sql, params) => {
      if (params.includes(last)) throw new Error("disk full");
    });
    const indexer = new VaultIndexer(vault, db, { scanTransactionMs: 0, onExternalModification: (p) => foreign.push(p) });
    await expect(indexer.indexVaultFull()).rejects.toThrow("disk full");
    restore();
    const ahead = (await db.query<{ path: string }>(`SELECT path FROM files WHERE sync_state = 'local_ahead'`)).map((r) => r.path).sort();
    expect([...foreign].sort()).toEqual(ahead);
    expect(ahead).toEqual(names.slice(0, NOTES - 1));
    await indexer.indexVaultFull();
    expect([...foreign].sort()).toEqual([...names].sort());
  });

  it.each([
    ["a note", "notes/n05.md", "notes/zz-moved.md", ["notes/n05.md"]],
    ["a folder", "notes", "zz-archive", names],
  ])("a path the app renamed away is not reported gone - %s, read again at its new place", async (_kind, from, to, olds) => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    await syncedOnce(vault, db);
    // A new note the scan reads first, in a transaction of its own.
    await vault.writeTextFile("a-first.md", "# First\n");
    // The move on disk, before the scan lists the vault; its rows move in the
    // queue's own transaction between two of the scan's, before the scan
    // reaches the moved files and before the shell has told the index
    // (`relocatePathInIndex`).
    await vault.renameItem(from, to);
    const gone: string[] = [];
    let moved = false;
    await new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      onLocalFileDeleted: (p) => gone.push(p),
      onProgress: () => {
        if (moved) return;
        moved = true;
        void new SyncQueue(db).queueRename(from, to);
      },
    }).indexVaultFull();
    expect(moved).toBe(true);
    expect(gone.filter((p) => olds.includes(p))).toEqual([]);
    expect(await queued(db, "delete")).toEqual([]);
    expect(await queued(db, "rename")).toEqual([from]);
  });

  it("does not overwrite what a pull wrote between two of its transactions, nor take it for a foreign change", async () => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    await syncedOnce(vault, db);
    const late = names[NOTES - 1];
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged in another app\n`);
    const pulled = "# Pulled\nfrom the remote\n";
    const foreign: string[] = [];
    let pulledIt = false;
    const repo = new SyncStateRepository(db);
    await new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      onExternalModification: (p) => foreign.push(p),
      onProgress: (current) => {
        if (current !== 3 || pulledIt) return;
        pulledIt = true;
        // The worker writes the remote's version and records it as the base, with its ETag.
        void (async () => {
          await vault.writeTextFile(late, pulled);
          const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(pulled));
          const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
          await repo.recordSyncedBase(late, { sha256: sha, etag: "etag-2", text: pulled }, { sha256: sha });
          await repo.updateRemoteState(late, "etag-2", null, Date.now());
        })();
      },
    }).indexVaultFull();
    expect(pulledIt).toBe(true);
    expect(foreign).not.toContain(late);
    expect(foreign).toContain(names[0]);
    const state = await db.queryOne<{ remote_etag: string; base_etag: string; base_text: string }>(`SELECT remote_etag, base_etag, base_text FROM sync_state WHERE path = ?`, [late]);
    expect(state).toMatchObject({ remote_etag: "etag-2", base_etag: "etag-2", base_text: pulled });
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [late]);
    expect(row?.content).toContain("from the remote");
  });

  it("keeps the row of a file put back at a vanished path between the listing and its last transaction", async () => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    await syncedOnce(vault, db);
    const back = names[0];
    await vault.deleteItem(back);
    for (const name of names.slice(1, 10)) await vault.writeTextFile(name, `# changed ${name}\n`);
    const gone: string[] = [];
    let putBack = false;
    const indexer: VaultIndexer = new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      onLocalFileDeleted: (p) => gone.push(p),
      onProgress: (current) => {
        if (current !== 2 || putBack) return;
        putBack = true;
        void (async () => {
          await vault.writeTextFile(back, "# Back again\n");
          await indexer.indexFile(await vault.getFileInfo(back));
        })();
      },
    });
    await indexer.indexVaultFull();
    expect(putBack).toBe(true);
    expect(gone).not.toContain(back);
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [back])).toEqual({ path: back });
  });

  it("removes the rows of vanished files with its last transaction", async () => {
    const vault = await vaultWithNotes();
    const db = takingTurns(await realSqlite());
    const gone: string[] = [];
    await new VaultIndexer(vault, db, { scanTransactionMs: 0 }).indexVaultFull();
    await vault.deleteItem(names[0]);
    await vault.deleteItem(names[1]);
    for (const name of names.slice(2, 12)) await vault.writeTextFile(name, `# changed ${name}\n`);
    await new VaultIndexer(vault, db, { scanTransactionMs: 0, onLocalFileDeleted: (p) => gone.push(p) }).indexVaultFull();
    expect(gone.sort()).toEqual([names[0], names[1]]);
    expect(await db.query(`SELECT path FROM files WHERE path IN (?, ?)`, [names[0], names[1]])).toEqual([]);
  });
});
