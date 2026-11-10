import { describe, expect, it } from "vitest";
import { beforeEveryWrite, realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer, type VaultIndexerOptions } from "../src/vault/VaultIndexer.js";

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
 *    scan, not overwritten with an older reading or taken for a foreign change.
 */

/** The same database with the manners of both shells' adapters: a second transaction waits for the first. */
function takingTurns(inner: IDatabaseAdapter): IDatabaseAdapter & { transactions: number } {
  let last: Promise<unknown> = Promise.resolve();
  const db = {
    ...inner,
    transactions: 0,
    transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
      db.transactions += 1;
      const run = last.then(() => inner.transaction(fn));
      last = run.catch(() => undefined);
      return run;
    },
  };
  return db;
}

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
