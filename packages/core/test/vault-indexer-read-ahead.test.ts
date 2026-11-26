import { beforeEach, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import type { IndexReadRequest, IndexReadResult, VaultFileInfo } from "../src/vault/IVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { steppingClock } from "./helpers/taskListing.js";

/**
 * The full scan reads ahead of the loop that indexes: a few files at a time,
 * bounded by bytes, within the transaction that writes them; on the desktop
 * a group of files in one call into Rust (`readFilesForIndex`).
 *
 * What must hold, as before:
 *  - the index is row for row the one a scan that reads one file at a time
 *    (`scanReadsAhead: 1`) writes, in the same order (rowids);
 *  - a note saved and indexed while the scan reads it ahead keeps the newer
 *    state, never overwritten by an older reading;
 *  - no transaction waits for a read;
 *  - a file gone between the listing and the read is left out without a word,
 *    a file that cannot be read is named and leaves only itself out — in the
 *    order of the pass, whatever order the reads come back in;
 *  - the weight of what is read ahead is bounded by bytes;
 *  - a host that reads many files in one call gets the same index, and
 *    whatever that call does not answer goes the ordinary way;
 *  - a scan called off ends at once, even with a read in flight that never
 *    answers, and begins no read after it.
 */
beforeEach(() => {
  expect.hasAssertions();
});

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
  for (const table of ["files", "links", "tags", "properties", "sync_state", "meta", "offline_queue", "fts_notes", "note_tasks"]) {
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`).catch(() => null);
    if (!rows) continue;
    out[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

/** The index a scan that reads one file per transaction writes: one read at a time. */
async function oneAtATime(vault: MemoryVaultAdapter): Promise<Record<string, unknown[]>> {
  const db = takingTurns(await realSqlite());
  await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: 0, scanReadsAhead: 1 }).indexVaultFull();
  return dump(db);
}

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A vault that reads many files in one call, as the desktop's bridge into Rust does. */
class ManyAtOnceVault extends SlowVault {
  calls: IndexReadRequest[][] = [];
  /** Calls in flight now, and the most there were at once. */
  callsInFlight = 0;
  mostCalls = 0;
  /** Paths the one call leaves to the ordinary read. */
  leaveToOrdinary = new Set<string>();
  async readFilesForIndex(requests: readonly IndexReadRequest[]): Promise<IndexReadResult[]> {
    this.calls.push([...requests]);
    this.callsInFlight++;
    this.mostCalls = Math.max(this.mostCalls, this.callsInFlight);
    try {
      return await this.answerMany(requests);
    } finally {
      this.callsInFlight--;
    }
  }
  private async answerMany(requests: readonly IndexReadRequest[]): Promise<IndexReadResult[]> {
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
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    expect(vault.most).toBeGreaterThan(1);
    expect(vault.most).toBeLessThanOrEqual(8);
    expect(await dump(db)).toEqual(reference);
  });

  it("with the default transactions of 100 ms as well", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock() }).indexVaultFull();
    expect(vault.most).toBeGreaterThan(1);
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
    // The target was read while earlier files were still being read: ahead.
    expect(vault.most).toBeGreaterThan(1);
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
    const report = await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    // The reads were in flight together and came back out of order.
    expect(vault.most).toBeGreaterThan(1);
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
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    // Two films of 9 MB are more than the 16 MB bound: at most one is read at a time —
    // while the small notes were read several at once.
    expect(vault.mostBytes).toBeLessThan(18 * MB);
    expect(vault.most).toBeGreaterThan(1);
    expect((await db.query(`SELECT path FROM files`)).length).toBe(10);
  });

  it("holds no more than a transaction's bound of text, what it took and what is ahead together", async () => {
    // Six notes of 9 MB: two are more than the 16 MB a transaction holds. A
    // reading taken keeps its weight until its transaction writes, so no
    // third is read into a transaction that holds two — the bound is one on
    // all that was read, not on what is ahead alone.
    const vault = new SlowVault(1_700_000_000_000);
    await vault.initialize();
    const MB = 1024 * 1024;
    for (let i = 0; i < 6; i++) await vault.writeTextFile(`big/n${i}.md`, `# ${i}\n${"x".repeat(9 * MB)}\n`);
    // And forty of 1 MB: when a transaction reaches its bound, the reads in flight must not
    // have been begun past it (they would join the transaction that took the sixteenth).
    for (let i = 0; i < 40; i++) await vault.writeTextFile(`mid/m${String(i).padStart(2, "0")}.md`, `# ${i}\n${"y".repeat(MB)}\n`);
    const inner = takingTurns(await realSqlite());
    // The text each transaction writes into the full-text table: what it held.
    const held: number[][] = [];
    const db: IDatabaseAdapter = {
      ...inner,
      transaction: <T,>(fn: (tx: SqlStatements) => Promise<T>) => inner.transaction(async (tx) => {
        const texts: number[] = [];
        const counting: SqlStatements = {
          ...tx,
          execute: async (sql: string, params?: unknown[]) => {
            if (/INTO fts_notes/.test(sql)) texts.push(String((params ?? [])[0] ?? "").length);
            return tx.execute(sql, params);
          },
          ...(tx.runBatch ? { runBatch: async (statements: Parameters<NonNullable<SqlStatements["runBatch"]>>[0]) => {
            for (const statement of statements) if (/INTO fts_notes/.test(statement.sql)) texts.push(String((statement.params ?? [])[0] ?? "").length);
            return tx.runBatch!(statements);
          } } : {}),
        };
        try { return await fn(counting); } finally { held.push(texts); }
      }),
    };
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    // Every transaction holds at most the bound and the one note that reached it: all but its
    // largest note together stay within 16 M characters. Two notes of 9 MB never get a third.
    const SLACK = 64 * 1024;
    for (const texts of held.filter((t) => t.length > 0)) {
      const total = texts.reduce((a, b) => a + b, 0);
      expect(total - Math.max(...texts), `a transaction of ${texts.length} notes`).toBeLessThanOrEqual(16 * MB + SLACK);
    }
    expect(Math.max(...held.map((t) => t.reduce((a, b) => a + b, 0)))).toBeLessThan(19 * MB);
    expect((await db.query(`SELECT path FROM files`)).length).toBe(46);
  });

  it.each([
    ["listed at 1 MB, 3 MB read", 1],
    ["listed at 0, 3 MB read", 0],
  ] as const)("weighs a file by what was read once it is in, where its listing names too little: %s", async (_name, listedMb) => {
    // Notes of 3 MB the listing names smaller. Weighed by the listing alone,
    // the scan would keep beginning reads past the bound; weighed by what came
    // in, nothing new begins once what is held passes it, and a transaction
    // holds at most the bound and what was in flight then (8 reads at once).
    const MB = 1024 * 1024;
    class ListedTooSmall extends SlowVault {
      override async listDir(p = "", recursive = false): Promise<VaultFileInfo[]> {
        return (await super.listDir(p, recursive)).map((f) => (f.path.startsWith("under/") ? { ...f, size: listedMb * MB } : f));
      }
    }
    const vault = new ListedTooSmall(1_700_000_000_000);
    await vault.initialize();
    for (let i = 0; i < 24; i++) await vault.writeTextFile(`under/u${String(i).padStart(2, "0")}.md`, `# ${i}\n${"z".repeat(3 * MB)}\n`);
    // The first read hangs a while, the others come back at once: while the scan waits to
    // take the first, the files after it are in and weigh what they hold. Weighed by the
    // listing, each that came in would make room for the next.
    vault.turnsFor = (path) => (path === "under/u00.md" ? 400 : 1);
    // What came in since the last transaction ended (the reads a transaction writes come
    // before it opens), and every read begun while that was already past the bound. The
    // scan learns a file's weight once its reading is handed over — after the hash —, so
    // reads begun in between count as in flight: at most as many as may be in flight at once.
    let cameIn = 0;
    const begunPastTheBound: number[] = [];
    vault.beforeRead = () => { if (cameIn > 16 * MB) begunPastTheBound.push(cameIn); };
    vault.afterRead = (path) => { if (path.startsWith("under/")) cameIn += 3 * MB; };
    const inner = takingTurns(await realSqlite());
    const held: number[][] = [];
    const db: IDatabaseAdapter = {
      ...inner,
      transaction: <T,>(fn: (tx: SqlStatements) => Promise<T>) => inner.transaction(async (tx) => {
        const texts: number[] = [];
        const counting: SqlStatements = {
          ...tx,
          execute: async (sql: string, params?: unknown[]) => {
            if (/INTO fts_notes/.test(sql)) texts.push(String((params ?? [])[0] ?? "").length);
            return tx.execute(sql, params);
          },
        };
        try { return await fn(counting); } finally { held.push(texts); cameIn = 0; }
      }),
    };
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    // Once what came in passes the bound, nothing new begins beyond what may be in flight.
    expect(begunPastTheBound.length).toBeLessThanOrEqual(8);
    expect(vault.most).toBeLessThanOrEqual(8);
    for (const texts of held.filter((t) => t.length > 0)) {
      // The bound, and what was in flight when it was passed: at most eight more files of 3 MB.
      expect(texts.reduce((a, b) => a + b, 0), `a transaction of ${texts.length} notes`).toBeLessThanOrEqual(16 * MB + 8 * 3 * MB + 64 * 1024);
    }
    expect((await db.query(`SELECT path FROM files`)).length).toBe(24);
  });

  it("reads in groups where the host reads many files in one call, with the same index, and sends the rest the ordinary way", async () => {
    const reference = await oneAtATime(await (async () => { const v = new MemoryVaultAdapter(1_700_000_000_000); await fill(v); return v; })());
    const vault = new ManyAtOnceVault(1_700_000_000_000);
    await fill(vault);
    vault.leaveToOrdinary = new Set([names[7]]);
    const db = takingTurns(await realSqlite());
    await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
    expect(await dump(db)).toEqual(reference);
    expect(vault.calls.length).toBeGreaterThan(1);
    expect(Math.max(...vault.calls.map((c) => c.length))).toBeLessThanOrEqual(8);
    // Two calls of eight in flight at once, never more.
    expect(vault.mostCalls).toBe(2);
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
      let asked = 0;
      vault.readFilesForIndex = async (requests: readonly IndexReadRequest[]) => {
        asked++;
        if (broken === "throws") throw new Error("the bridge is down");
        if (broken === "short") return [];
        // A text answer for a file asked for as bytes, and the other way round.
        return requests.map((r): IndexReadResult => (r.text ? { kind: "bytes", sha256: "0".repeat(64) } : { kind: "text", text: "x", sha256: "0".repeat(64) }));
      };
      const db = takingTurns(await realSqlite());
      await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: Number.POSITIVE_INFINITY }).indexVaultFull();
      expect(asked, broken).toBeGreaterThan(0);
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
      expect(vault.most).toBeGreaterThan(1);
      for (let i = 0; i < 30; i++) await tick();
      expect(strays).toEqual([]);
      expect(vault.inFlight).toBe(0);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });

  // As before (a transaction of no time reads nothing ahead): one file per transaction, the next read while the one before writes.
  it("keeps the row of a note saved and indexed between two transactions, one file each (held as before)", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const target = names[5];
    let saved: Promise<void> | null = null;
    // One file per transaction: the next file is read while the transaction
    // before it is open, and written in a transaction of its own.
    const indexer: VaultIndexer = new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: 0 });
    vault.afterRead = async (path) => {
      if (path !== target || saved) return;
      // The scan holds the old text; the save writes and indexes the new one
      // before the scan's reading is handed over, so the scan's transaction
      // for the note comes after the save's (since L2 the scan waits for a
      // reading outside its transactions: without waiting here, the save's
      // slower disk write came last and the scan's stale text never met it).
      saved = (async () => {
        await vault.writeTextFile(target, "# Saved\nafter the scan read ahead\n");
        await indexer.indexFile(await vault.getFileInfo(target));
      })();
      await saved;
    };
    await indexer.indexVaultFull();
    expect(saved).not.toBeNull();
    await saved;
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [target]);
    expect(row?.content).toContain("after the scan read ahead");
    const file = await db.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = ?`, [target]);
    expect(file?.mtime_local).toBe((await vault.getFileInfo(target)).mtime);
  });

  it("reads nothing more once it was called off, where the host reads many files in one call ", async () => {
    // Groups of eight, two at a time: the bound of what is read and not taken
    // is sixteen files, and a group that ends makes room for the next. Without
    // the stop the reads went on behind a scan that had ended.
    const vault = new ManyAtOnceVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const leaving = new AbortController();
    const indexer = new VaultIndexer(vault, db, {
      scanSignal: leaving.signal,
      onProgress: (current) => { if (current === 4) leaving.abort(); },
    });
    await expect(indexer.indexVaultFull()).rejects.toThrow();
    // Ended does not wait for a read in flight (a read that never answers must
    // not hold the close), and begins nothing new.
    const callsAtAbort = vault.calls.length;
    const begunAtAbort = vault.begun.length;
    // The calls in flight end in their own time (each file a few turns).
    // Their hashes are worked out off the event loop: wait by time, not by turns.
    for (let i = 0; i < 500 && vault.inFlight > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    for (let i = 0; i < 40; i++) await tick();
    expect(vault.inFlight).toBe(0);
    expect(vault.calls.length).toBe(callsAtAbort);
    // What the calls in flight held is read to their end; no file outside them.
    const held = vault.calls.flat().length;
    expect(begunAtAbort).toBeLessThanOrEqual(held);
    expect(vault.begun.length).toBeLessThanOrEqual(held);
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
    // It was reading ahead when it was called off.
    expect(vault.most).toBeGreaterThan(1);
    const begunAtAbort = vault.begun.length;
    for (let i = 0; i < 40; i++) await tick();
    // What was in flight settles; nothing new begins (the reads ahead are at most 8).
    expect(vault.begun.length).toBe(begunAtAbort);
    expect(vault.begun.length).toBeLessThanOrEqual(4 + 8);
  });

  it.each([
    ["one read per call", false, 100],
    ["one read per call, a bound the scan never reaches", false, 60_000],
    ["many reads per call (the desktop)", true, 100],
    ["many reads per call, a bound the scan never reaches", true, 60_000],
  ] as const)("keeps no transaction open while it waits for a read: %s (held as before, now with reads ahead)", async (_name, many, txMs) => {
    // A transaction used to wait inside itself for the reading of the file it
    // was at: a large file on slow media held it open for as long as the read
    // took, and every other writer of the index waited behind it. Here a read
    // can only END while no transaction is open: a transaction that waited
    // for one would wait for ever (the test runs into its timeout). With the
    // files the ordinary way goes for: refused, gone since the listing, two
    // large ones, text that is no UTF-8.
    let open = 0;
    const betweenTransactions = async () => { while (open > 0) await tick(); };
    const vault = many ? new ManyAtOnceVault(1_700_000_000_000) : new SlowVault(1_700_000_000_000);
    await fill(vault);
    await vault.writeBinaryFile("films/a.bin", new Uint8Array(9 * 1024 * 1024));
    await vault.writeBinaryFile("films/b.bin", new Uint8Array(9 * 1024 * 1024).fill(1));
    vault.refuse = new Set([names[7], "pictures/a.png"]);
    if (many) (vault as ManyAtOnceVault).leaveToOrdinary = new Set([names[7], names[13], "pictures/a.png"]);
    const vanishing = names[13];
    // Gone between the listing and the read: left out without a word.
    vault.beforeRead = async (path) => {
      if (path === vanishing && (await vault.exists(path))) await vault.deleteItem(path);
    };
    vault.afterRead = betweenTransactions;
    const inner = takingTurns(await realSqlite());
    const db: IDatabaseAdapter = {
      ...inner,
      transaction: <T,>(fn: (tx: SqlStatements) => Promise<T>) => inner.transaction(async (tx) => {
        open++;
        try { return await fn(tx); } finally { open--; }
      }),
    };
    const report = await new VaultIndexer(vault, db, { monotonicNow: steppingClock(), scanTransactionMs: txMs }).indexVaultFull();
    expect(report.skipped.map((s) => s.path).sort()).toEqual([names[7], "pictures/a.png"].sort());
    const rows = (await db.query<{ path: string }>("SELECT path FROM files")).map((r) => r.path);
    expect(rows).toContain("films/a.bin");
    expect(rows).toContain("data/latin1.csv");
    expect(rows).not.toContain(names[7]);
    expect(rows).not.toContain(vanishing);
    expect(rows.filter((p) => p.startsWith("notes/")).length).toBe(NOTES - 2);
  });
});

describe("whose reading stands: the one whose look at the file began later ", () => {
  /** A vault indexed once, then changed elsewhere note by note, so the next full scan reads every note. */
  async function changedEverywhere(vault: SlowVault): Promise<{ db: IDatabaseAdapter; indexer: VaultIndexer }> {
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const indexer = new VaultIndexer(vault, db, {});
    await indexer.indexVaultFull();
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged elsewhere\n`);
    return { db, indexer };
  }
  const indexed = async (db: IDatabaseAdapter, path: string) =>
    (await db.query<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [path])).map((r) => r.content).join(" | ");

  it("a save whose read began EARLIER does not stand over the scan's newer reading", async () => {
    // The app saves T and indexes it: its read begins. Another program writes
    // T again. The scan reads that, the newest, ahead. The save's pass writes
    // its older reading first. A check of the row against the one the scan
    // began with took that for "indexed meanwhile" and dropped the scan's
    // newer reading: the index kept an older text than the disk — on the
    // phone, which has no watcher, until the next full scan.
    const vault = new SlowVault(1_700_000_000_000);
    const { db, indexer } = await changedEverywhere(vault);
    const T = names[20];
    let save: Promise<unknown> | null = null;
    let saveReadsT = false;
    let scanReadT = 0;
    vault.afterRead = async (path) => {
      if (path === names[3] && !save) {
        await vault.writeTextFile(T, "# T\nc2 saved in the app\n");
        saveReadsT = true;
        save = indexer.indexFile(await vault.getFileInfo(T));
        return;
      }
      if (path === T && saveReadsT) {
        // The save has its reading (c2); another program writes c3 after it.
        saveReadsT = false;
        await vault.writeTextFile(T, "# T\nc3 written elsewhere, the newest\n");
        return;
      }
      if (path === T) {
        scanReadT++;
        // The scan holds c3; the save writes c2 before the scan writes T.
        await save;
      }
    };
    await indexer.indexVaultFull();
    await save;
    // The save landed after the scan's read began: the scan reads T once more
    // (`changesSince`) and that reading, the newest, stands.
    expect(scanReadT).toBeGreaterThanOrEqual(1);
    expect(await vault.readTextFile(T)).toContain("c3");
    expect(await indexed(db, T)).toContain("c3 written elsewhere");
    // The scan read ahead while this happened.
    expect(vault.most).toBeGreaterThan(1);
  });

  it("a file the app removed while its reading was ahead is not brought back into the index", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    const { db, indexer } = await changedEverywhere(vault);
    const X = names[6];
    let removed = false;
    vault.afterRead = async (path) => {
      if (path !== X || removed) return;
      // The scan holds X's text. The app deletes X and takes it out of the index.
      removed = true;
      await vault.deleteItem(X);
      await indexer.removePathFromIndex(X);
    };
    await indexer.indexVaultFull();
    expect(removed).toBe(true);
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [X])).toBeNull();
    expect(await indexed(db, X)).toBe("");
    // The scan read ahead while this happened.
    expect(vault.most).toBeGreaterThan(1);
  });

  it("a file the app moved while its reading was ahead is not written back at its old place", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    const { db, indexer } = await changedEverywhere(vault);
    const A = names[6];
    const B = "moved/n06.md";
    let moved = false;
    vault.afterRead = async (path) => {
      if (path !== A || moved) return;
      moved = true;
      await vault.renameItem(A, B);
      await indexer.relocatePathInIndex(A, B);
    };
    await indexer.indexVaultFull();
    expect(moved).toBe(true);
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [A])).toBeNull();
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [B])).not.toBeNull();
    // The scan read ahead while this happened.
    expect(vault.most).toBeGreaterThan(1);
  });

  it("a file the one call leaves to the ordinary read takes its place where that read begins", async () => {
    // The desktop reads a group in one call; a file it does not answer is read
    // the ordinary way afterwards. Its place among the reads was the group's —
    // taken before the call — so a save read between the two counted as
    // later, and its older reading stood over the newer one the scan read.
    class HookedMany extends ManyAtOnceVault {
      beforeCall?: (requests: readonly IndexReadRequest[]) => Promise<void>;
      async readFilesForIndex(requests: readonly IndexReadRequest[]): Promise<IndexReadResult[]> {
        await this.beforeCall?.(requests);
        return super.readFilesForIndex(requests);
      }
    }
    const vault = new HookedMany(1_700_000_000_000);
    const { db, indexer } = await changedEverywhere(vault);
    const F = names[2];
    vault.leaveToOrdinary = new Set([F]);
    let done = false;
    vault.beforeCall = async (requests) => {
      if (done || !requests.some((r) => r.path === F)) return;
      done = true;
      // The call is made: the app saves F and its pass reads and writes it…
      await vault.writeTextFile(F, "# F\nc2 saved in the app\n");
      await indexer.indexFile(await vault.getFileInfo(F));
      // …then another program writes F; the ordinary read of F comes after.
      await vault.writeTextFile(F, "# F\nc3 written elsewhere, the newest\n");
    };
    await indexer.indexVaultFull();
    expect(done).toBe(true);
    expect(await indexed(db, F)).toContain("c3 written elsewhere");
  });
});

describe("saves, moves and closes while the scan reads ahead", () => {
  it("a note the app renames while the scan reads it ahead is not written back under its old name — the queue's rename takes no place", async () => {
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const created: string[] = [];
    const indexer = new VaultIndexer(vault, db, { onNewLocalFile: (p) => void created.push(p) });
    await indexer.indexVaultFull();
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged elsewhere\n`);
    const queue = new SyncQueue(db);
    const T = names[20];
    const TO = "moved.md";
    let renamed = false;
    vault.afterRead = async (path) => {
      if (path !== T || renamed) return;
      // The scan holds T's reading; the person renames T: the disk, then the queue
      // moves the row. The index hears of it later (relocatePathInIndex), after the scan.
      renamed = true;
      await vault.renameItem(T, TO);
      await queue.queueRename(T, TO);
    };
    created.length = 0;
    await indexer.indexVaultFull();
    expect(renamed).toBe(true);
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [T])).toBeNull();
    expect(created).not.toContain(T);
    await indexer.relocatePathInIndex(T, TO);
    expect(await db.queryOne(`SELECT path FROM files WHERE path = ?`, [TO])).not.toBeNull();
    // No search row and no sync row left for a file that is not there.
    expect((await db.query(`SELECT path FROM fts_notes WHERE path = ?`, [T])).length).toBe(0);
    expect(await db.queryOne(`SELECT path FROM sync_state WHERE path = ?`, [T])).toBeNull();
    // The scan read ahead while this happened.
    expect(vault.most).toBeGreaterThan(1);
  });

  it("a file read by a call for many files whose order against a save cannot be told is read again (the desktop's one read path)", async () => {
    // The call is made; the app saves T and its pass reads and writes it; another
    // program writes T again; the call then reads T. The call says when it began
    // and ended, not when it read T: the two readings are not ordered by a guess.
    class SequentialMany extends SlowVault {
      beforeEach?: (path: string) => Promise<void>;
      async readFilesForIndex(requests: readonly IndexReadRequest[]): Promise<IndexReadResult[]> {
        const out: IndexReadResult[] = [];
        for (const request of requests) {
          await this.beforeEach?.(request.path);
          if (!request.text) { out.push({ kind: "fallback" }); continue; }
          const text = await MemoryVaultAdapter.prototype.readTextFile.call(this, request.path);
          out.push({ kind: "text", text, sha256: await sha256Hex(new TextEncoder().encode(text)) });
        }
        return out;
      }
    }
    const vault = new SequentialMany(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const indexer = new VaultIndexer(vault, db, {});
    await indexer.indexVaultFull();
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged elsewhere\n`);
    const T = names[5];
    let saved = false;
    vault.beforeEach = async (path) => {
      if (path !== T || saved) return;
      saved = true;
      await vault.writeTextFile(T, "# T\nc2 saved in the app\n");
      await indexer.indexFile(await vault.getFileInfo(T));
      await vault.writeTextFile(T, "# T\nc3 written elsewhere, the newest\n");
    };
    await indexer.indexVaultFull();
    expect(saved).toBe(true);
    const content = (await db.query<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [T])).map((r) => r.content).join(" | ");
    expect(content).toContain("c3 written elsewhere");
  });

  it("a file the index let go of before the scan began to read it, and that is there again, gets its row from the scan", async () => {
    // The row went in a change of the index's own (a watcher's delete) whose
    // place lies before the scan's reading: that reading is newer, and the
    // row it writes stands — the row is not "gone" (`changedBefore`).
    const vault = new SlowVault(1_700_000_000_000);
    await fill(vault);
    const db = takingTurns(await realSqlite());
    const indexer = new VaultIndexer(vault, db, {});
    await indexer.indexVaultFull();
    for (const name of names) await vault.writeTextFile(name, `# ${name}\nchanged elsewhere\n`);
    const X = names[40];
    let removed = false;
    vault.beforeRead = async (path) => {
      if (path !== names[1] || removed) return;
      removed = true;
      await indexer.removePathFromIndex(X);
    };
    await indexer.indexVaultFull();
    expect(removed).toBe(true);
    expect(vault.begun.indexOf(X)).toBeGreaterThan(vault.begun.indexOf(names[1]));
    const row = await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [X]);
    expect(row?.content).toContain("changed elsewhere");
    // The scan read ahead while this happened.
    expect(vault.most).toBeGreaterThan(1);
  });

  it("a vault closed while a read ahead never answers: the scan ends, and so does whenIdle, which the close waits for", async () => {
    // A provider that hangs on one file, a share that dropped without an
    // error: the first scan reads ahead, the person closes the vault while the
    // scan holds a later file. A scan that waited for the hung read would hold
    // the close with it.
    const closing = new AbortController();
    class HangVault extends MemoryVaultAdapter {
      armed = false;
      override async readTextFile(path: string): Promise<string> {
        if (this.armed && path === "n05.md") return new Promise<string>(() => {});
        const text = await super.readTextFile(path);
        for (let i = 0; i < 2; i++) await tick();
        if (this.armed && path === "n07.md") closing.abort();
        return text;
      }
    }
    const vault = new HangVault(1_700_000_000_000);
    await vault.initialize();
    for (let i = 0; i < 20; i++) await vault.writeTextFile(`n${String(i).padStart(2, "0")}.md`, `# ${i}\n`);
    const db = await realSqlite();
    const indexer = new VaultIndexer(vault, db, { scanSignal: closing.signal });
    vault.armed = true;
    const within = <T>(p: Promise<T>, ms: number) => Promise.race([p.then(() => "settled", () => "settled"), new Promise<string>((r) => setTimeout(() => r("still waiting"), ms))]);
    const scan = indexer.indexVaultFull("open");
    expect(await within(scan, 2000)).toBe("settled");
    await expect(scan).rejects.toThrow();
    expect(await within(indexer.whenIdle(), 500)).toBe("settled");
    expect(closing.signal.aborted).toBe(true);
  });
});
