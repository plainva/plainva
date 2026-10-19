import { afterEach, describe, expect, it } from "vitest";
import { FixtureSqliteAdapter, isFixtureSqliteAvailable } from "./adapters/FixtureSqliteAdapter";

/**
 * The screenshot fixture's database client (rework N0.1).
 *
 * Two things are worth pinning here, and both come from real failures rather
 * than from imagination:
 *
 *  - The bridge must be ABSENT in a normal build. If it were ever mistaken for
 *    present, a shipped app would try to reach a database that does not exist.
 *  - A batch runs inside a transaction. `runBatch` is called from inside the
 *    indexer's `transaction()`, and SQLite rejects a second BEGIN. The first
 *    version of this adapter opened unconditionally, the index blew up with
 *    "cannot start a transaction within a transaction" — and because the boot
 *    swallows index errors, the app just ran on WITHOUT an index. The capture
 *    then photographed empty states again, which is the exact failure N0.1
 *    exists to end. A test that only checked a flat transaction would have
 *    stayed green through it.
 *
 * And one thing that is not a failure of this adapter but of what it stood in
 * for (finding 2026-10-12): it used to let a second transaction ENTER the
 * first, where the phone's connection refused it. Two flows of the app then
 * shared one transaction in every run on this bridge, and none of those runs
 * could show what a device does when two transactions meet. They take turns
 * now, as on the device (adapters/transactionTurns.ts).
 */

const BRIDGE_KEY = "__plainvaFixtureSql";

/** Installs a recording bridge and returns the statements it saw. */
function installBridge(rows: unknown[] = []) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  (globalThis as Record<string, unknown>)[BRIDGE_KEY] = {
    exec: async (_db: string, sql: string, params: unknown[]) => {
      seen.push({ sql, params });
    },
    all: async (_db: string, sql: string, params: unknown[]) => {
      seen.push({ sql, params });
      return rows;
    },
  };
  return seen;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[BRIDGE_KEY];
});

describe("fixture sqlite bridge", () => {
  it("reports itself absent when no runner installed it", () => {
    expect(isFixtureSqliteAvailable()).toBe(false);
  });

  it("ignores a half-built bridge rather than trusting it", () => {
    (globalThis as Record<string, unknown>)[BRIDGE_KEY] = { exec: () => {} };
    expect(isFixtureSqliteAvailable()).toBe(false);
  });

  it("is available once both functions are there", () => {
    installBridge();
    expect(isFixtureSqliteAvailable()).toBe(true);
  });
});

describe("FixtureSqliteAdapter", () => {
  it("runs a batch its caller sends from inside its own transaction without a second BEGIN", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    // Exactly the shape the indexer uses: a batch flushed from within its
    // transaction, saying so. This is the call that broke the index.
    await db.transaction(async () => {
      await db.runBatch(
        [
          { sql: "INSERT INTO files VALUES (?)", params: ["a.md"] },
          { sql: "INSERT INTO files VALUES (?)", params: ["b.md"] },
        ],
        { inOpenTransaction: true },
      );
    });

    expect(seen.map((s) => s.sql)).toEqual(["BEGIN", "INSERT INTO files VALUES (?)", "INSERT INTO files VALUES (?)", "COMMIT"]);
  });

  it("a batch by itself is one transaction", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.runBatch([
      { sql: "DELETE FROM pim_events" },
      { sql: "INSERT INTO pim_events VALUES (?)", params: ["e1"] },
    ]);

    expect(seen.map((s) => s.sql)).toEqual(["BEGIN", "DELETE FROM pim_events", "INSERT INTO pim_events VALUES (?)", "COMMIT"]);
  });

  it("two transactions asked for in the same moment run one after the other", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    // A save's entry in the sync queue, the index following a pulled file and
    // a calendar that is replaced: three flows that do not know of each other.
    await Promise.all([
      db.transaction(async () => {
        await db.execute("INSERT INTO offline_queue VALUES (?)", ["a.md"]);
        await db.execute("UPDATE files SET sync_state = 'local_ahead'");
      }),
      db.transaction(async () => {
        await db.execute("INSERT INTO files VALUES (?)", ["b.md"]);
      }),
      db.runBatch([{ sql: "DELETE FROM pim_events" }]),
    ]);

    // It used to be one BEGIN and one COMMIT around all of it: the second
    // transaction entered the first.
    expect(seen.map((s) => s.sql)).toEqual([
      "BEGIN", "INSERT INTO offline_queue VALUES (?)", "UPDATE files SET sync_state = 'local_ahead'", "COMMIT",
      "BEGIN", "INSERT INTO files VALUES (?)", "COMMIT",
      "BEGIN", "DELETE FROM pim_events", "COMMIT",
    ]);
  });

  it("rolls a failed transaction back, and the next one is its own", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    const failed = db.transaction(async () => {
      await db.execute("INSERT INTO t VALUES (?)", [1]);
      throw new Error("boom");
    });
    const next = db.transaction(async () => {
      await db.execute("INSERT INTO t VALUES (?)", [2]);
    });
    await expect(failed).rejects.toThrow("boom");
    await next;

    expect(seen.map((s) => s.sql)).toEqual([
      "BEGIN", "INSERT INTO t VALUES (?)", "ROLLBACK",
      "BEGIN", "INSERT INTO t VALUES (?)", "COMMIT",
    ]);
  });

  it("a batch after a transaction that failed is a transaction of its own again", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.transaction(async () => {
      throw new Error("first");
    }).catch(() => {});
    await db.runBatch([{ sql: "INSERT INTO t VALUES (?)", params: [1] }], { inOpenTransaction: true });

    // A mark left behind by the failed transaction would send this batch into
    // "the transaction that is open" — there is none: the writes would land
    // outside any transaction. The caller's word alone does not decide it.
    expect(seen.map((s) => s.sql)).toEqual(["BEGIN", "ROLLBACK", "BEGIN", "INSERT INTO t VALUES (?)", "COMMIT"]);
  });

  it("binds an absent value as null", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.execute("UPDATE files SET title = ? WHERE path = ?", [undefined, "a.md"]);

    // JSON has no `undefined`: left alone it would arrive as a MISSING
    // argument and SQLite would reject the statement outright.
    expect(seen[seen.length - 1]?.params).toEqual([null, "a.md"]);
  });

  it("flattens named parameters like the native adapter does", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.query("SELECT * FROM files WHERE path = :path", { path: "a.md" });

    expect(seen[seen.length - 1]?.params).toEqual(["a.md"]);
  });

  it("returns null from queryOne when nothing matched", async () => {
    installBridge([]);
    const db = new FixtureSqliteAdapter("test");
    expect(await db.queryOne("SELECT 1")).toBeNull();
  });
});
