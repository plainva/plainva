import { describe, it, expect, vi } from "vitest";
import { runStatementsAtomic } from "../src/db/batch.ts";
import { IDatabaseAdapter, BatchStatement } from "../src/db/IDatabaseAdapter.ts";

function baseAdapter(): IDatabaseAdapter {
  return {
    initialize: async () => {},
    close: async () => {},
    execute: async () => {},
    query: async () => [],
    queryOne: async () => null,
    transaction: async (fn) => fn(),
  };
}

const stmts: BatchStatement[] = [
  { sql: "INSERT INTO t (a) VALUES (?)", params: [1] },
  { sql: "DELETE FROM t WHERE a = ?", params: [2] },
];

describe("runStatementsAtomic", () => {
  it("uses runBatch once with all statements when the adapter supports it", async () => {
    const db = baseAdapter();
    const runBatch = vi.fn(async () => {});
    const execute = vi.fn(async () => {});
    db.runBatch = runBatch;
    db.execute = execute;

    await runStatementsAtomic(db, stmts);

    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(runBatch).toHaveBeenCalledWith(stmts);
    expect(execute).not.toHaveBeenCalled();
  });

  it("falls back to one execute per statement, in order, when runBatch is absent", async () => {
    const db = baseAdapter();
    const calls: { sql: string; params: unknown[] }[] = [];
    db.execute = async (q, p) => {
      calls.push({ sql: q, params: (p ?? []) as unknown[] });
    };

    await runStatementsAtomic(db, stmts);

    expect(calls).toEqual([
      { sql: "INSERT INTO t (a) VALUES (?)", params: [1] },
      { sql: "DELETE FROM t WHERE a = ?", params: [2] },
    ]);
  });

  it("does nothing for an empty batch", async () => {
    const db = baseAdapter();
    const runBatch = vi.fn(async () => {});
    const execute = vi.fn(async () => {});
    db.runBatch = runBatch;
    db.execute = execute;

    await runStatementsAtomic(db, []);

    expect(runBatch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
