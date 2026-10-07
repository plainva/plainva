import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A batch of writes reaches the phone's database as ONE native call (plan
 * Befunde 2026-10-06, K1).
 *
 * The phone has a single SQLite connection. A real transaction keeps a failed
 * replace from leaving half its rows behind, but it does not keep a READER
 * out: a query sent between two statements of the batch runs on the same
 * connection and sees the calendar with its events deleted and not yet
 * written back. `executeSet` hands the whole list over at once.
 *
 * The plugin is replaced by a recorder — what this pins is the SHAPE of the
 * call. That the native side runs it as one transaction is the plugin's
 * contract; it has not been watched on a device from here.
 */

const calls: Array<{ op: string; args: unknown[] }> = [];

vi.mock("@capacitor-community/sqlite", () => {
  const db = {
    open: async () => {},
    close: async () => {},
    run: async (...args: unknown[]) => void calls.push({ op: "run", args }),
    query: async () => ({ values: [] }),
    beginTransaction: async () => void calls.push({ op: "begin", args: [] }),
    commitTransaction: async () => void calls.push({ op: "commit", args: [] }),
    rollbackTransaction: async () => void calls.push({ op: "rollback", args: [] }),
    executeSet: async (...args: unknown[]) => void calls.push({ op: "executeSet", args }),
  };
  class SQLiteConnection {
    async checkConnectionsConsistency() {
      return { result: false };
    }
    async isConnection() {
      return { result: false };
    }
    async createConnection() {
      return db;
    }
    async retrieveConnection() {
      return db;
    }
    async closeConnection() {}
  }
  return { CapacitorSQLite: {}, SQLiteConnection };
});

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");

describe("CapacitorSqliteAdapter.runBatch", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("hands the statements to the plugin as one transactional set", async () => {
    const adapter = new CapacitorSqliteAdapter("idx");
    await adapter.initialize();
    await adapter.runBatch([
      { sql: "DELETE FROM pim_events WHERE account_id = ?", params: ["a1"] },
      { sql: "INSERT INTO pim_events (account_id, uid) VALUES (?, ?)", params: ["a1", "e1"] },
      { sql: "UPDATE pim_accounts SET enabled = 1" },
    ]);
    expect(calls).toEqual([
      {
        op: "executeSet",
        args: [
          [
            { statement: "DELETE FROM pim_events WHERE account_id = ?", values: ["a1"] },
            { statement: "INSERT INTO pim_events (account_id, uid) VALUES (?, ?)", values: ["a1", "e1"] },
            { statement: "UPDATE pim_accounts SET enabled = 1", values: [] },
          ],
          true,
        ],
      },
    ]);
  });

  it("does nothing for an empty batch", async () => {
    const adapter = new CapacitorSqliteAdapter("idx");
    await adapter.initialize();
    await adapter.runBatch([]);
    expect(calls).toEqual([]);
  });

  it("inside an open transaction runs the statements in it, one by one, as before", async () => {
    // The indexer flushes its batches inside `transaction()`. SQLite has no
    // nested transactions, and this path must stay exactly what it was.
    const adapter = new CapacitorSqliteAdapter("idx");
    await adapter.initialize();
    await adapter.transaction(async () => {
      await adapter.runBatch([
        { sql: "DELETE FROM files WHERE id = ?", params: ["f1"] },
        { sql: "INSERT INTO files (id) VALUES (?)", params: ["f1"] },
      ]);
    });
    expect(calls.map((c) => c.op)).toEqual(["begin", "run", "run", "commit"]);

    // And once that transaction is over, a batch is a set again.
    calls.length = 0;
    await adapter.runBatch([{ sql: "DELETE FROM pim_tasks", params: [] }]);
    expect(calls.map((c) => c.op)).toEqual(["executeSet"]);
  });

  it("a transaction that fails is over too: the next batch is a set", async () => {
    const adapter = new CapacitorSqliteAdapter("idx");
    await adapter.initialize();
    await expect(
      adapter.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    calls.length = 0;
    await adapter.runBatch([{ sql: "DELETE FROM pim_tasks" }]);
    expect(calls.map((c) => c.op)).toEqual(["executeSet"]);
  });
});
