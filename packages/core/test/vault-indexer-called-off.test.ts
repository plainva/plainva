import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { withinAsync } from "./helpers/timeBudget.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { writesRefusedAfter } from "../src/vault/indexerCalledOff.js";

/**
 * Closing a vault does not wait for a read that never answers, and a reading
 * that comes back after all writes nothing (indexerCalledOff.ts).
 *
 * Both shells close a vault by calling the index's signal off and waiting
 * for its runs (`VaultIndexer.whenIdle`): the desktop's teardown, whose
 * promise the next open of the same vault waits for, and the phone's
 * `dispose`, which closes the database after it. A run settled only when its
 * read came back — on a share that dropped, never.
 *
 * Real files and a real SQLite. The reads that hang here come back when the
 * test lets them, to show what a late answer does.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-called-off-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

/** The vault, with the reads of `held` answered only once `release()` is called; the read itself is made at once. */
function hangingReads(held: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const reading = new Promise<void>((resolve) => { reached = resolve; });
  const answered: Promise<unknown>[] = [];
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return (p: string, ...rest: unknown[]) => {
        const read = (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        if (p !== held) return read;
        reached();
        const late = read.then(async (answer) => { await gate; return answer; });
        answered.push(late.catch(() => undefined));
        return late;
      };
    },
  });
  /** Lets the held reads answer, and returns once they have and the event loop has run what they set off. */
  const answerLate = async () => {
    release();
    await Promise.all(answered);
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  return { vault, reading, answerLate };
}

/** What `target` was asked to write: statements, batches and transaction bodies that ran. */
function countingWrites(target: IDatabaseAdapter): { db: IDatabaseAdapter; writes: () => number } {
  let writes = 0;
  const counted: IDatabaseAdapter = new Proxy(target, {
    get(inner, key, receiver) {
      const value = Reflect.get(inner, key, receiver);
      if (typeof value !== "function") return value;
      if (key === "execute" || key === "runBatch") {
        return (...args: unknown[]) => { writes++; return (value as (...a: unknown[]) => unknown).apply(inner, args); };
      }
      if (key === "transaction") {
        return <T,>(fn: (tx: SqlStatements) => Promise<T>) => (value as IDatabaseAdapter["transaction"]).call(inner, async (tx: SqlStatements) => {
          const handle: SqlStatements = {
            query: (sql, params) => tx.query(sql, params),
            queryOne: (sql, params) => tx.queryOne(sql, params),
            execute: (sql, params) => { writes++; return tx.execute(sql, params); },
            // Only where the database has batches: the indexer asks for them.
            ...(tx.runBatch ? { runBatch: (statements: Parameters<NonNullable<SqlStatements["runBatch"]>>[0]) => { writes++; return tx.runBatch!(statements); } } : {}),
          };
          return fn(handle);
        }) as Promise<T>;
      }
      return value.bind(inner);
    },
  });
  return { db: counted, writes: () => writes };
}

const indexedPaths = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((row) => row.path);

describe("closing a vault does not wait for the index's reads", () => {
  it("a full scan whose read hangs settles as soon as it is called off, and the late answer writes nothing", async () => {
    await raw.writeTextFile("Share/A.md", "# A\n\nalpha\n");
    await raw.writeTextFile("Share/Hung.md", "# Hung\n\nlate words\n");
    const { vault, reading, answerLate } = hangingReads("Share/Hung.md");
    const { db: counted, writes } = countingWrites(db);
    const closing = new AbortController();
    const indexer = new VaultIndexer(vault, counted, { scanSignal: closing.signal, scanTransactionMs: 0 });
    const scan = indexer.indexVaultFull();
    scan.catch(() => {});
    await reading;
    const before = await indexedPaths();
    const writesBefore = writes();
    closing.abort();
    // The owner's wait — the desktop's teardown, the phone's dispose — ends without the read.
    await withinAsync(250, () => indexer.whenIdle());
    await expect(scan).rejects.toThrow();
    // The same vault opened again on the same file, as the desktop reaches its database by its path.
    const reopened = new VaultIndexer(raw, db);
    expect(await reopened.indexComplete()).toBeTypeOf("boolean");
    await answerLate();
    expect(writes(), "nothing written after the vault was closed").toBe(writesBefore);
    expect(await indexedPaths()).toEqual(before);
    expect(before).not.toContain("Share/Hung.md");
  });

  it("a single path whose read hangs fails as soon as the index is called off, and its late answer writes nothing", async () => {
    await raw.writeTextFile("Share/Hung.md", "# Hung\n\nlate words\n");
    const { vault, reading, answerLate } = hangingReads("Share/Hung.md");
    const { db: counted, writes } = countingWrites(db);
    const closing = new AbortController();
    const indexer = new VaultIndexer(vault, counted, { scanSignal: closing.signal });
    const look = indexer.indexPath("Share/Hung.md");
    look.catch(() => {});
    await reading;
    const writesBefore = writes();
    closing.abort();
    // The desktop's watcher queue waits for its batch before the vault counts as closed.
    await withinAsync(250, () => look.catch(() => "called off"));
    await answerLate();
    expect(writes()).toBe(writesBefore);
    expect(await indexedPaths()).toEqual([]);
  });

  it("the header check of an AppleDouble file on a share that hangs does not hold the close either", async () => {
    await raw.writeTextFile("Mac/Note.md", "# Note\n");
    await raw.writeBinaryFile("Mac/._Note.md", new Uint8Array([0x00, 0x05, 0x16, 0x07, 0, 2, 0, 0]));
    const { vault, reading, answerLate } = hangingReads("Mac/._Note.md");
    const closing = new AbortController();
    const indexer = new VaultIndexer(vault, db, { scanSignal: closing.signal });
    const scan = indexer.indexVaultFull();
    scan.catch(() => {});
    await reading;
    closing.abort();
    await withinAsync(250, () => indexer.whenIdle());
    await expect(scan).rejects.toThrow();
    await answerLate();
    expect(await indexedPaths()).toEqual([]);
  });

  it("a transaction that waited for its turn while the index was called off is rolled back before its body runs", async () => {
    const closing = new AbortController();
    const refusing = writesRefusedAfter(db, closing.signal);
    let letGo!: () => void;
    const holding = new Promise<void>((resolve) => { letGo = resolve; });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    // Another flow's transaction holds the turn.
    const first = db.transaction(async (tx) => {
      open();
      await holding;
      await tx.execute("INSERT INTO meta (key, value) VALUES ('first', '1')");
    });
    await opened;
    let ran = false;
    const queued = refusing.transaction(async (tx) => {
      ran = true;
      await tx.execute("INSERT INTO meta (key, value) VALUES ('late', '1')");
    });
    queued.catch(() => {});
    closing.abort();
    letGo();
    await first;
    await expect(queued).rejects.toThrow();
    expect(ran).toBe(false);
    expect(await db.queryOne("SELECT value FROM meta WHERE key = 'late'")).toBeNull();
    await expect(refusing.execute("INSERT INTO meta (key, value) VALUES ('after', '1')")).rejects.toThrow();
    // Reads go on: the owner may still look.
    expect(await refusing.queryOne("SELECT value FROM meta WHERE key = 'first'")).toEqual({ value: "1" });
  });
});
