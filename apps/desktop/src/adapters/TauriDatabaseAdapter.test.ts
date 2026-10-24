import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the desktop's database adapter does with a transaction that fails
 * (finding 2026-10-12).
 *
 * It sits on a connection pool and cannot hold a transaction across calls,
 * so `transaction()` is a turn: a second one waits, every statement is
 * committed as it runs, and nothing is taken back. The index reports what it
 * wrote after its transaction; a scan that failed half-way had written rows
 * it never reported. It now asks the adapter whether a failed transaction
 * keeps its writes (`keepsWhatAFailedTransactionWrote`) — and that answer has
 * to stay true to what the adapter does. This file holds the two together:
 * whoever gives the adapter a real transaction takes the flag away with it.
 *
 * The plugin is replaced by a recorder; what is pinned is which statements
 * reach it. The phone's adapter has the same test from the other side
 * (`apps/mobile/src/capacitorSqliteBatch.test.ts`).
 */

const calls: Array<{ op: string; sql?: string }> = [];

vi.mock("@tauri-apps/plugin-sql", () => {
  const db = {
    execute: async (sql: string) => void calls.push({ op: "execute", sql }),
    select: async () => [],
    close: async () => {},
  };
  return { default: { load: async () => db, get: () => db } };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => void calls.push({ op: command }),
}));

const { TauriDatabaseAdapter } = await import("./TauriDatabaseAdapter");

async function opened() {
  const adapter = new TauriDatabaseAdapter("sqlite:index.db");
  await adapter.initialize();
  calls.length = 0;
  return adapter;
}

describe("TauriDatabaseAdapter.transaction", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("is a turn, not a transaction: a failure takes nothing back — and the adapter says so", async () => {
    const adapter = await opened();
    await expect(
      adapter.transaction(async () => {
        await adapter.execute("DELETE FROM files WHERE path = ?", ["gone.md"]);
        await adapter.runBatch([{ sql: "INSERT INTO files (id, path) VALUES (?, ?)", params: ["1", "new.md"] }]);
        throw new Error("a file vanished before its read");
      }),
    ).rejects.toThrow("a file vanished");

    // Both writes went out, and nothing asked the database to undo them.
    expect(calls).toEqual([{ op: "execute", sql: "DELETE FROM files WHERE path = ?" }, { op: "db_batch" }]);
    expect(calls.some((c) => /^\s*(BEGIN|ROLLBACK|COMMIT)/i.test(c.sql ?? ""))).toBe(false);
    expect(adapter.keepsWhatAFailedTransactionWrote).toBe(true);
  });

  it("keeps a second transaction out until the first is through, also when the first fails", async () => {
    const adapter = await opened();
    const order: string[] = [];
    let release: () => void = () => {};
    const first = adapter.transaction(async () => {
      order.push("first begins");
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first fails");
      throw new Error("first");
    });
    const second = adapter.transaction(async () => {
      order.push("second runs");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first begins"]);
    release();
    await expect(first).rejects.toThrow("first");
    await second;
    expect(order).toEqual(["first begins", "first fails", "second runs"]);
  });
});
