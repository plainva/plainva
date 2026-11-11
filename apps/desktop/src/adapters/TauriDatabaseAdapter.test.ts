import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopSqlite } from "../../../../packages/core/test/helpers/desktopSqlite";

/**
 * Real transactions on the desktop (stability plan R1).
 *
 * The SQL plugin sits on a connection pool and cannot hold a `BEGIN` across
 * calls, so `transaction()` used to be a turn and nothing else: every
 * statement committed as it ran, a body that failed left half of what it
 * meant to write, and a kill between a note's `files` row and its full-text
 * row left the note unsearchable until it was edited. A transaction now runs
 * on a connection Rust holds for it (`src-tauri/src/db_tx.rs`).
 *
 * What runs here is the shipped adapter. Stood in for is the native side only
 * (`desktopSqlite.ts`: the plugin's pool and the commands, each on its own
 * connection to one real SQLite file in WAL mode, every call crossing the
 * bridge). The phone's adapter has the same scenes from its side
 * (`apps/mobile/src/capacitorSqliteTurns.test.ts`). Nothing of this ran in
 * the built app from here; the Rust side has its own tests (`db_tx.rs`).
 */

vi.mock("@tauri-apps/plugin-sql", async () => (await import("../../../../packages/core/test/helpers/desktopSqlite")).desktopSqlite.module.sql);
vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("../../../../packages/core/test/helpers/desktopSqlite")).desktopSqlite.module.invoke,
}));

const { TauriDatabaseAdapter } = await import("./TauriDatabaseAdapter");
const { initializeSchema, VaultIndexer, VaultQueryService } = await import("@plainva/core");
const { LocalVaultAdapter } = await import("../../../../packages/core/src/vault/LocalVaultAdapter");
type SqlStatements = import("@plainva/core").SqlStatements;

const URL = "sqlite:index.db";
const hops = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function open() {
  desktopSqlite.reset();
  const adapter = new TauriDatabaseAdapter(URL);
  await adapter.initialize();
  await adapter.execute("CREATE TABLE t (k TEXT PRIMARY KEY)");
  await adapter.execute("CREATE TABLE child (k TEXT REFERENCES t(k))");
  desktopSqlite.log.length = 0;
  /** A row, through a transaction's handle — or, without one, sent to the adapter itself. */
  const put = (key: string, on: SqlStatements = adapter) => on.execute("INSERT INTO t (k) VALUES (?)", [key]);
  /** What another program, or the next start, finds in the file. */
  const keys = () => desktopSqlite.read<{ k: string }>("SELECT k FROM t ORDER BY k").map((row) => row.k);
  return { adapter, put, keys };
}

beforeEach(() => desktopSqlite.reset());
afterAll(() => desktopSqlite.reset());

describe("a transaction on the desktop", () => {
  it("that fails takes back what its body wrote, statements and batches — nothing stays", async () => {
    const { adapter, put, keys } = await open();
    await expect(
      adapter.transaction(async (tx) => {
        await put("a statement of the body", tx);
        // From inside the body of its own transaction, as the full scan flushes.
        await tx.runBatch!([{ sql: "INSERT INTO t (k) VALUES (?)", params: ["a batch of the body"] }]);
        expect(await tx.query("SELECT k FROM t")).toHaveLength(2);
        throw new Error("a file vanished before its read");
      }),
    ).rejects.toThrow("a file vanished");
    expect(keys()).toEqual([]);
    expect(desktopSqlite.log).toEqual(["db_tx_begin", "db_tx_execute", "db_tx_batch", "db_tx_select", "db_tx_rollback"]);
    expect(desktopSqlite.openTransactions()).toBe(0);
    // The flag that said otherwise is gone with the behaviour it described.
    expect("keepsWhatAFailedTransactionWrote" in adapter).toBe(false);
  });

  it("that goes through is seen by others only once it is committed", async () => {
    const { adapter, put, keys } = await open();
    let release!: () => void;
    const body = new Promise<void>((resolve) => { release = resolve; });
    const running = adapter.transaction(async (tx) => {
      await put("inside", tx);
      await body;
    });
    await hops(8);
    // A read takes no turn and sees what is committed: a search does not wait for a full scan.
    expect(await adapter.query("SELECT k FROM t")).toEqual([]);
    expect(keys()).toEqual([]);
    release();
    await running;
    expect(keys()).toEqual(["inside"]);
  });

  it("they take turns in the order they were asked for, whatever the one before them did", async () => {
    const { adapter, put, keys } = await open();
    const outcomes = await Promise.allSettled([
      adapter.transaction((tx) => put("one", tx)),
      adapter.transaction(async (tx) => {
        await put("two", tx);
        throw new Error("the pass could not read its file");
      }),
      adapter.transaction((tx) => put("three", tx)),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(desktopSqlite.log).toEqual([
      "db_tx_begin", "db_tx_execute", "db_tx_commit",
      "db_tx_begin", "db_tx_execute", "db_tx_rollback",
      "db_tx_begin", "db_tx_execute", "db_tx_commit",
    ]);
    expect(keys()).toEqual(["one", "three"]);
  });

  it("a single write sent while a transaction is open waits for it, and stays when that one goes back", async () => {
    // Sent at once, it would meet the transaction's write lock on another
    // connection and fail ("database is locked") — or, before R1, have been
    // committed in the middle of somebody else's body.
    const { adapter, put, keys } = await open();
    const failing = adapter.transaction(async (tx) => {
      await put("inside", tx);
      await hops(12);
      throw new Error("the pass could not read its file");
    });
    await hops(4);
    const elsewhere = put("a statement from elsewhere");
    await expect(failing).rejects.toThrow("could not read");
    await elsewhere;
    expect(desktopSqlite.log).toEqual(["db_tx_begin", "db_tx_execute", "db_tx_rollback", "execute"]);
    expect(keys()).toEqual(["a statement from elsewhere"]);
  });

  it("a batch from elsewhere waits as well, is one call, and does not go down with the body", async () => {
    const { adapter, put, keys } = await open();
    const scan = adapter.transaction(async (tx) => {
      await put("a row of the scan", tx);
      await hops(12);
      throw new Error("the scan could not read a file");
    });
    await hops(4);
    const calendar = adapter.runBatch([
      { sql: "DELETE FROM t WHERE k LIKE 'event %'" },
      { sql: "INSERT INTO t (k) VALUES (?)", params: ["event 1"] },
    ]);
    await expect(scan).rejects.toThrow("could not read");
    await calendar;
    expect(desktopSqlite.log).toEqual(["db_tx_begin", "db_tx_execute", "db_tx_rollback", "db_batch"]);
    expect(keys()).toEqual(["event 1"]);
  });

  it("a body that sends a write to the adapter instead of its handle is told so, with where it was opened — under the tests, in seconds", async () => {
    const { adapter, put, keys } = await open();
    const outcome = await adapter.transaction(async () => {
      await put("to the adapter, from inside");
    }).then(() => "ran", (error: Error) => error.message);
    expect(outcome).toMatch(/waited \d+ ms for the transaction opened .*TauriDatabaseAdapter\.test\.ts/);
    expect(outcome).toMatch(/instead of its handle \(tx\) waits for itself/);
    expect(keys()).toEqual([]);
    expect(desktopSqlite.openTransactions()).toBe(0);
  }, 10_000);

  it("a handle is good for its body only: used after the body ended, it throws instead of running outside any turn", async () => {
    const { adapter, put, keys } = await open();
    let kept: SqlStatements | null = null;
    await adapter.transaction(async (tx) => { kept = tx; });
    await expect(put("late", kept!)).rejects.toThrow("This transaction is over");
    expect(keys()).toEqual([]);
  });

  it("a COMMIT that fails ends that transaction: nothing of it stays, and the next one runs", async () => {
    const { adapter, put, keys } = await open();
    // A foreign key checked at COMMIT: the commit itself is refused.
    await expect(adapter.transaction(async (tx) => {
      await tx.execute("PRAGMA defer_foreign_keys = ON");
      await put("written before the refusal", tx);
      await tx.execute("INSERT INTO child (k) VALUES (?)", ["no such parent"]);
    })).rejects.toThrow(/FOREIGN KEY/);
    expect(desktopSqlite.openTransactions()).toBe(0);
    await adapter.transaction((tx) => put("the next one", tx));
    expect(keys()).toEqual(["the next one"]);
  });

  it("a transaction whose BEGIN fails gives its turn back", async () => {
    const { adapter, put, keys } = await open();
    // Another program holds the write lock: the BEGIN IMMEDIATE is refused.
    const release = desktopSqlite.holdWriteLock();
    await expect(adapter.transaction((tx) => put("never", tx))).rejects.toThrow(/locked|busy/i);
    release();
    await adapter.transaction((tx) => put("next", tx));
    expect(keys()).toEqual(["next"]);
  });
});

describe("closing the desktop's database", () => {
  it("waits for the transactions asked for before it, and what is asked for afterwards finds it closed", async () => {
    const { adapter, put, keys } = await open();
    const scan = adapter.transaction(async (tx) => { await put("the scan", tx); await hops(6); });
    const announced = adapter.transaction((tx) => put("an entry that waited", tx));
    const closing = adapter.close();
    const late = adapter.transaction((tx) => put("too late", tx)).then(() => "ran", (error: Error) => error.message);
    await Promise.all([scan, announced, closing]);
    expect(await late).toBe("Database not initialized");
    expect(keys()).toEqual(["an entry that waited", "the scan"]);
    // The pool, then the connection Rust kept for the next transaction.
    expect(desktopSqlite.log.slice(-2)).toEqual(["close", "db_tx_close"]);
  });
});

describe("an auxiliary window's handle (attachReadOnly)", () => {
  it("reads in a transaction through the pool, opens none in Rust, and writes nothing", async () => {
    const { adapter: owner, put } = await open();
    await put("there");
    const aux = new TauriDatabaseAdapter(URL);
    aux.attachReadOnly();
    desktopSqlite.log.length = 0;
    const seen = await aux.transaction((tx) => tx.query<{ k: string }>("SELECT k FROM t"));
    expect(seen.map((row) => row.k)).toEqual(["there"]);
    await expect(aux.transaction((tx) => tx.execute("DELETE FROM t"))).rejects.toThrow("writes nothing");
    await expect(aux.execute("DELETE FROM t")).rejects.toThrow("writes nothing");
    expect(desktopSqlite.log.some((op) => op.startsWith("db_tx"))).toBe(false);
    await owner.close();
  });
});

describe("the app ends between a note's files row and its full-text row (R1, from wave 1)", () => {
  it("leaves neither: the next start finds the note new, and it is searchable after the next pass", async () => {
    const root = await mkdtemp(join(tmpdir(), "plainva-r1-kill-"));
    try {
      const vault = new LocalVaultAdapter(root);
      await vault.initialize();
      desktopSqlite.reset();
      const first = new TauriDatabaseAdapter(URL);
      await first.initialize();
      await initializeSchema(first);
      await writeFile(join(root, "Zeppelin.md"), "# Zeppelin\n\nballoon over the lake\n", "utf8");
      // The save's own pass: one note, read and written in one transaction.
      const ended = desktopSqlite.endProcessAfter((sql) => /^\s*INSERT INTO files\b/.test(sql));
      void new VaultIndexer(vault, first).indexFile(await vault.getFileInfo("Zeppelin.md"));
      await ended;
      expect(desktopSqlite.read("SELECT path FROM files"), "the kill took the files row back with the rest").toEqual([]);

      // The next start, the same file.
      desktopSqlite.restart();
      const next = new TauriDatabaseAdapter(URL);
      await next.initialize();
      await initializeSchema(next);
      await new VaultIndexer(vault, next).indexVaultFull("open");
      const hits = await new VaultQueryService(next).searchFullText("balloon");
      expect(hits.map((hit) => hit.path)).toEqual(["Zeppelin.md"]);
      await next.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
