import { describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import type { IndexReadRequest, IndexReadResult } from "../src/vault/IVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";

/**
 * The full scan reads ahead of the loop that indexes (performance plan L2,
 * finding B3). It used to read one file, index it, read the next — each read
 * a round trip over the desktop's bridge or the phone's plugin bridge.
 *
 * What must hold, as before:
 *  - the index is row for row the one a scan that reads one file at a time
 *    writes, in the same order (rowids);
 *  - a reading is written in the transaction that read it: a note saved while
 *    the scan reads is indexed after it, never overwritten by an older reading;
 *  - a file gone between the listing and the read is left out without a word,
 *    a file that cannot be read is named — in the order of the pass, whatever
 *    order the reads come back in;
 *  - the weight of what is read ahead is bounded by bytes;
 *  - a host that reads many files in one call (`readFilesForIndex`, the
 *    desktop) gets the same index, and whatever that call does not answer goes
 *    the ordinary way;
 *  - a scan called off with reads in flight ends cleanly.
 */

/** A second transaction waits for the first, as in both shells. */
function takingTurns(inner: IDatabaseAdapter): IDatabaseAdapter {
  let last: Promise<unknown> = Promise.resolve();
  return {
    ...inner,
    transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
      const run = last.then(() => inner.transaction(fn));
      last = run.catch(() => undefined);
      return run;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A vault whose reads take a few turns of the event loop, counted while in flight. */
class SlowVault extends MemoryVaultAdapter {
  inFlight = 0;
  most = 0;
  bytesInFlight = 0;
  mostBytes = 0;
  /** How many turns a read of a path takes (default 2): reverse orders can be built. */
  turnsFor: (path: string) => number = () => 2;
  refuse = new Set<string>();
  beforeRead?: (path: string) => Promise<void> | void;
  /** Called once a read has its bytes, before it returns them. */
  afterRead?: (path: string) => Promise<void> | void;
  /** Every read begun, in order. */
  begun: string[] = [];
  private async slow<T>(path: string, read: () => Promise<T>): Promise<T> {
    const size = (await this.getFileInfo(path).catch(() => null))?.size ?? 0;
    this.inFlight++;
    this.bytesInFlight += size;
    this.most = Math.max(this.most, this.inFlight);
    this.mostBytes = Math.max(this.mostBytes, this.bytesInFlight);
    try {
      this.begun.push(path);
      await this.beforeRead?.(path);
      for (let i = 0; i < this.turnsFor(path); i++) await tick();
      if (this.refuse.has(path)) throw Object.assign(new Error("Access is denied"), { code: "EACCES" });
      const value = await read();
      await this.afterRead?.(path);
      return value;
    } finally {
      this.inFlight--;
      this.bytesInFlight -= size;
    }
  }
  async readTextFile(path: string): Promise<string> {
    return this.slow(path, () => super.readTextFile(path));
  }
  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.slow(path, () => super.readBinaryFile(path));
  }
}

const NOTES = 60;
const names = Array.from({ length: NOTES }, (_, i) => `notes/n${String(i).padStart(2, "0")}.md`);

async function fill(vault: MemoryVaultAdapter): Promise<void> {
  await vault.initialize();
  for (const [i, name] of names.entries()) {
    await vault.writeTextFile(name, `---\ntitle: Note ${i}\n---\n# Note ${i}\nSee [[n${String((i + 1) % NOTES).padStart(2, "0")}]] #tag${i % 3}\n- [ ] task ${i}\n`);
  }
  await vault.writeBinaryFile("pictures/a.png", new Uint8Array([1, 2, 3]));
  await vault.writeBinaryFile("pictures/b.png", new Uint8Array([4, 5, 6]));
  // A `.csv` in Windows-1252: text by its name, not by its bytes.
  await vault.writeBinaryFile("data/latin1.csv", new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]));
}

/** Every row of the index's own tables, in rowid order where the order is the scan's. */
async function dump(db: IDatabaseAdapter): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  out.filesInOrder = (await db.query<{ path: string }>(`SELECT path FROM files ORDER BY rowid`)).map((r) => r.path);
  for (const table of ["files", "links", "tags", "properties", "sync_state", "meta", "offline_queue", "fts_notes"]) {
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`).catch(() => null);
    if (!rows) continue;
    out[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

/** The index a scan that reads one file per transaction writes: one read at a time. */
async function oneAtATime(vault: MemoryVaultAdapter): Promise<Record<string, unknown[]>> {
  const db = takingTurns(await realSqlite());
  await new VaultIndexer(vault, db, { scanTransactionMs: 0 }).indexVaultFull();
  return dump(db);
}

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A vault that reads many files in one call, as the desktop's bridge into Rust does. */
class ManyAtOnceVault extends SlowVault {
  calls: IndexReadRequest[][] = [];
  /** Paths the one call leaves to the ordinary read. */
  leaveToOrdinary = new Set<string>();
  async readFilesForIndex(requests: readonly IndexReadRequest[]): Promise<IndexReadResult[]> {
    this.calls.push([...requests]);
    await tick();
    const out: IndexReadResult[] = [];
    for (const request of requests) {
      if (this.leaveToOrdinary.has(request.path)) { out.push({ kind: "fallback" }); continue; }
      const bytes = await super.readBinaryFile(request.path).catch(() => null);
      if (!bytes) { out.push({ kind: "fallback" }); continue; }
      const sha256 = await sha256Hex(bytes);
      if (!request.text) { out.push({ kind: "bytes", sha256 }); continue; }
      try {
        out.push({ kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sha256 });
      } catch {
        out.push({ kind: "fallback" });
      }
    }
    return out;
  }
}

describe("a full scan that reads ahead", () => {
  it("keeps several reads in flight and writes the index a scan of one read at a time writes, row for row", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    expect(vault.most).toBeGreaterThan(1);
    expect(vault.most).toBeLessThanOrEqual(8);
    expect(await dump(db)).toEqual(reference);
  });

  it("with the default transactions of 100 ms as well", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db).indexVaultFull();
    expect(await dump(db)).toEqual(reference);
  });

  it("indexes a note saved while the scan reads it ahead after the scan's reading, never under it", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    // n10 is read ahead while n05 is read; the save lands between that reading and its write.
    const target = names[10];
    let saved: Promise<void> | null = null;
    const indexer: VaultIndexer = new VaultIndexer(vault, db, {
      scanTransactionMs: Number.POSITIVE_INFINITY,
    });
    let sawTargetRead = false;
    vault.beforeRead = (path) => {
      if (path === target) sawTargetRead = true;
      if (path === names[12] && sawTargetRead && !saved) {
        saved = (async () => {
          await vault.writeTextFile(target, "# Saved\nwhile the scan read ahead\n");
          await indexer.indexFile(await vault.getFileInfo(target));
        })();
      }
    };
    await indexer.indexVaultFull();
    expect(saved).not.toBeNull();
    await saved;
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [target]);
    expect(row?.content).toContain("while the scan read ahead");
    const file = await db.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = ?`, [target]);
    expect(file?.mtime_local).toBe((await vault.getFileInfo(target)).mtime);
  });

  it("names the files it cannot read in the order of the pass, and leaves out a file gone since the listing", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    // Later files answer first: a read-ahead that noted refusals as they came would reverse them.
    vault.turnsFor = (path) => (path.startsWith("notes/") ? 2 + (NOTES - Number(path.slice(7, 9))) % 9 : 1);
    vault.refuse = new Set([names[3], names[4], names[30]]);
    const gone = names[20];
    let deleted = false;
    vault.beforeRead = async (path) => {
      if (path === gone && !deleted) {
        deleted = true;
        await vault.deleteItem(gone);
      }
    };
    const db = takingTurns(await realSqlite());
    const report = await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    expect(report.skipped).toEqual([names[3], names[4], names[30]].map((path) => ({ path, reason: "unreadable" })));
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [gone])).toBeNull();
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [names[3]])).toBeNull();
    expect(report.added).toBe(NOTES + 3 - 4);
  });

  it("does not read several large files at once: the weight ahead is bounded by bytes", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await vault.initialize();
    const MB = 1024 * 1024;
    for (let i = 0; i < 4; i++) await vault.writeBinaryFile(`films/f${i}.bin`, new Uint8Array(9 * MB).fill(i + 1));
    for (let i = 0; i < 6; i++) await vault.writeTextFile(`n${i}.md`, `# ${i}\n`);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    // Two films of 9 MB are more than the 16 MB bound: at most one is read at a time.
    expect(vault.mostBytes).toBeLessThan(18 * MB);
    expect((await db.query(`SELECT path FROM files`)).length).toBe(10);
  });

  it("reads in groups where the host reads many files in one call, with the same index, and sends the rest the ordinary way", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    const vault = new ManyAtOnceVault(1_700_000_000_000);
    await fill(vault);
    vault.leaveToOrdinary = new Set([names[7]]);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    expect(await dump(db)).toEqual(reference);
    expect(vault.calls.length).toBeGreaterThan(1);
    expect(Math.max(...vault.calls.map((c) => c.length))).toBeLessThanOrEqual(8);
    // The note, the attachments and the `.csv` are asked for the way they are indexed.
    const asked = new Map(vault.calls.flat().map((r) => [r.path, r.text]));
    expect(asked.get(names[0])).toBe(true);
    expect(asked.get("pictures/a.png")).toBe(false);
    expect(asked.get("data/latin1.csv")).toBe(true);
  });

  it("a one-call reader that fails or answers wrongly costs nothing: every file goes the ordinary way", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    for (const broken of ["throws", "short", "wrong kind"] as const) {
      const vault = new ManyAtOnceVault(1_700_000_000_000);
      await fill(vault);
      vault.readFilesForIndex = async (requests: readonly IndexReadRequest[]) => {
        if (broken === "throws") throw new Error("the bridge is down");
        if (broken === "short") return [];
        // A text answer for a file asked for as bytes, and the other way round.
        return requests.map((r): IndexReadResult => (r.text ? { kind: "bytes", sha256: "0".repeat(64) } : { kind: "text", text: "x", sha256: "0".repeat(64) }));
      };
      const db = takingTurns(await realSqlite());
      await new VaultIndexer(vault, db, { scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
      expect(await dump(db), broken).toEqual(reference);
    }
  });

  it("is passed through the app's adapter chain only where the innermost adapter has it", async () => {
    const db = await realSqlite();
    const plain = new MemoryVaultAdapter();
    const many = new ManyAtOnceVault();
    const chain = (inner: MemoryVaultAdapter) =>
      new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(inner), new SyncQueue(db)), new SyncStateRepository(db, inner, "device"));
    expect(chain(plain).readFilesForIndex).toBeUndefined();
    const withMany = chain(many);
    expect(typeof withMany.readFilesForIndex).toBe("function");
    await many.writeTextFile("a.md", "# A\n");
    expect(await withMany.readFilesForIndex!([{ path: "a.md", text: true }])).toEqual([{ kind: "text", text: "# A\n", sha256: await sha256Hex(new TextEncoder().encode("# A\n")) }]);
  });

  it("called off with reads in flight, ends without a stray failure", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const leaving = new AbortController();
    const strays: unknown[] = [];
    const onStray = (reason: unknown) => strays.push(reason);
    process.on("unhandledRejection", onStray);
    try {
      const indexer = new VaultIndexer(vault, db, {
        scanTransactionMs: Number.POSITIVE_INFINITY,
        scanSignal: leaving.signal,
        onProgress: (current) => { if (current === 15) leaving.abort(); },
      });
      await expect(indexer.indexVaultFull()).rejects.toThrow();
      for (let i = 0; i < 30; i++) await tick();
      expect(strays).toEqual([]);
      expect(vault.inFlight).toBe(0);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });

  it("keeps the row of a note saved and indexed between two transactions while its reading was ahead", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const target = names[5];
    let saved: Promise<void> | null = null;
    // One file per transaction: the next file is read while the transaction
    // before it is open, and written in a transaction of its own.
    const indexer: VaultIndexer = new VaultIndexer(vault, db, { scanTransactionMs: 0 });
    vault.afterRead = (path) => {
      if (path !== target || saved) return;
      // The scan holds the old text; the save writes and indexes the new one
      // in a transaction that takes its turn before the scan writes the note.
      saved = (async () => {
        await vault.writeTextFile(target, "# Saved\nafter the scan read ahead\n");
        await indexer.indexFile(await vault.getFileInfo(target));
      })();
    };
    await indexer.indexVaultFull();
    expect(saved).not.toBeNull();
    await saved;
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [target]);
    expect(row?.content).toContain("after the scan read ahead");
    const file = await db.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = ?`, [target]);
    expect(file?.mtime_local).toBe((await vault.getFileInfo(target)).mtime);
  });

  it("reads nothing more once it was called off or failed", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const leaving = new AbortController();
    const indexer = new VaultIndexer(vault, db, {
      scanTransactionMs: Number.POSITIVE_INFINITY,
      scanSignal: leaving.signal,
      onProgress: (current) => { if (current === 4) leaving.abort(); },
    });
    await expect(indexer.indexVaultFull()).rejects.toThrow();
    const begunAtAbort = vault.begun.length;
    for (let i = 0; i < 40; i++) await tick();
    // What was in flight settles; nothing new begins (the reads ahead are at most 8).
    expect(vault.begun.length).toBe(begunAtAbort);
    expect(vault.begun.length).toBeLessThanOrEqual(4 + 8);
  });
});
