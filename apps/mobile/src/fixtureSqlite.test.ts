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
 *  - Transactions nest. `runBatch` is called from inside `transaction()`, and
 *    SQLite rejects a second BEGIN. The first version of this adapter opened
 *    unconditionally, the index blew up with "cannot start a transaction
 *    within a transaction" — and because the boot swallows index errors, the
 *    app just ran on WITHOUT an index. The capture then photographed empty
 *    states again, which is the exact failure N0.1 exists to end. A test that
 *    only checked a flat transaction would have stayed green through it.
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
  it("opens exactly one transaction when they nest", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.transaction(async () => {
      await db.transaction(async () => {
        await db.execute("INSERT INTO t VALUES (?)", [1]);
      });
    });

    expect(seen.filter((s) => s.sql === "BEGIN")).toHaveLength(1);
    expect(seen.filter((s) => s.sql === "COMMIT")).toHaveLength(1);
  });

  it("runs a batch inside an open transaction without a second BEGIN", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    // Exactly the shape the indexer uses: a batch flushed from within a
    // transaction. This is the call that broke the index.
    await db.transaction(async () => {
      await db.runBatch([
        { sql: "INSERT INTO files VALUES (?)", params: ["a.md"] },
        { sql: "INSERT INTO files VALUES (?)", params: ["b.md"] },
      ]);
    });

    expect(seen.filter((s) => s.sql === "BEGIN")).toHaveLength(1);
    expect(seen.filter((s) => s.sql === "COMMIT")).toHaveLength(1);
    expect(seen.filter((s) => s.sql.startsWith("INSERT INTO files"))).toHaveLength(2);
  });

  it("rolls back once, from the outermost frame only", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await expect(
      db.transaction(async () => {
        await db.transaction(async () => {
          throw new Error("boom");
        });
      }),
    ).rejects.toThrow("boom");

    expect(seen.filter((s) => s.sql === "ROLLBACK")).toHaveLength(1);
    expect(seen.filter((s) => s.sql === "COMMIT")).toHaveLength(0);
  });

  it("recovers its depth after a failed transaction", async () => {
    const seen = installBridge();
    const db = new FixtureSqliteAdapter("test");

    await db.transaction(async () => {
      throw new Error("first");
    }).catch(() => {});
    await db.transaction(async () => {
      await db.execute("INSERT INTO t VALUES (?)", [1]);
    });

    // A leaked depth would make the second transaction a silent no-op — the
    // writes would land outside any transaction and the failure would only
    // show up as missing rows much later.
    expect(seen.filter((s) => s.sql === "BEGIN")).toHaveLength(2);
    expect(seen.filter((s) => s.sql === "COMMIT")).toHaveLength(1);
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
