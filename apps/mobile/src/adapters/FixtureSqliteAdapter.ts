import type { BatchOptions, BatchStatement, IDatabaseAdapter } from "@plainva/core";
import { TransactionTurns } from "./transactionTurns";

/**
 * IDatabaseAdapter over a REAL SQLite that lives outside the browser.
 *
 * Why this exists (mobile rework N0.1): on the plain web server the phone has
 * no index at all — `@capacitor-community/sqlite` has no backing store there,
 * so `initialize()` throws and the app runs without search, without `.base`
 * rows and without a graph. Every browser-side verification of those surfaces
 * therefore compared an EMPTY STATE against an empty state. The screenshot
 * baseline did exactly that for fifteen steps: its "graph" picture never
 * showed a graph, it showed "the map appears once the search index is built",
 * in all 180 images.
 *
 * The fix is not a query mock. A mock answers the queries someone thought of;
 * the indexer and the graph fire many more, and a fixture-driven fake is how
 * you get a green run over a surface that renders nothing. Instead the
 * screenshot runner opens a real `node:sqlite` database per vault and exposes
 * two functions into the page; this adapter is the thin client for them. The
 * indexer, the query service and `GraphService` then run their ACTUAL SQL
 * against actual SQLite — the same engine the phone uses natively.
 *
 * This is the mobile counterpart of the desktop E2E's `__TAURI_INTERNALS__`
 * mock: the seam sits at the platform boundary, and it only exists when the
 * runner installed it. In every real build — native or plain web — the bridge
 * is absent and {@link isFixtureSqliteAvailable} returns false.
 */

/** Shape the screenshot runner installs on `globalThis` before the app boots. */
export interface FixtureSqlBridge {
  /** Runs a write statement. Rejects on SQL errors, like the native adapter. */
  exec(db: string, sql: string, params: unknown[]): Promise<void>;
  /** Runs a read statement and returns the rows as plain JSON objects. */
  all(db: string, sql: string, params: unknown[]): Promise<unknown[]>;
}

const BRIDGE_KEY = "__plainvaFixtureSql";

function bridge(): FixtureSqlBridge | null {
  const candidate = (globalThis as Record<string, unknown>)[BRIDGE_KEY];
  if (!candidate || typeof candidate !== "object") return null;
  const b = candidate as Partial<FixtureSqlBridge>;
  return typeof b.exec === "function" && typeof b.all === "function" ? (b as FixtureSqlBridge) : null;
}

/** True only while a screenshot/fixture run has installed the bridge. */
export function isFixtureSqliteAvailable(): boolean {
  return bridge() !== null;
}

/**
 * Named parameters are flattened to positional ones exactly like the native
 * adapter does, so both take the same call sites without the callers caring.
 */
function toPositional(params?: unknown[] | Record<string, unknown>): unknown[] {
  if (!params) return [];
  const values = Array.isArray(params) ? params : Object.values(params);
  // Playwright's exposed functions carry their arguments as JSON, and JSON has
  // no `undefined`: an undefined bind value would arrive as a MISSING argument
  // and SQLite would reject the statement. Normalising here keeps the failure
  // mode identical to the native driver (which binds NULL).
  return values.map((v) => (v === undefined ? null : v));
}

export class FixtureSqliteAdapter implements IDatabaseAdapter {
  /**
   * One transaction at a time, exactly as the native adapter has it
   * (transactionTurns.ts): the runner's database is one connection too, and
   * SQLite refuses a second BEGIN.
   *
   * This adapter used to count a depth instead and let a second transaction
   * ENTER the first — which kept the index alive (an unconditional BEGIN from
   * the indexer's batch inside its own transaction had failed, the boot
   * swallowed that, and the app ran on without an index: precisely the silent
   * hole this adapter exists to close). But it also meant that two flows of
   * the app shared one transaction here, where the phone refused the second:
   * nothing these runs showed said anything about what a device does when two
   * transactions meet (finding 2026-10-12).
   */
  private readonly turns = new TransactionTurns();
  /** The body of a `transaction()` is running. `runBatch` reads it. */
  private inTransaction = false;

  constructor(private readonly dbName: string) {}

  private conn(): FixtureSqlBridge {
    const b = bridge();
    if (!b) throw new Error("fixture sql bridge not installed");
    return b;
  }

  async initialize(): Promise<void> {
    // The runner opens the database; a round trip proves it answers.
    await this.conn().all(this.dbName, "SELECT 1", []);
    // The database outlives the page (see `close`), and so did a transaction
    // that a page left open when it was reloaded or closed in the middle of an
    // index pass: the next page's BEGIN failed with "cannot start a
    // transaction within a transaction", and the app ran on without an index —
    // the silent hole described above, through another door (seen on
    // 2026-10-06: one run in three of a spec that reloads right after start;
    // the desktop's mock lives in the page and goes with it, so it has no such
    // door). A process that dies takes its open transaction with it; opening
    // the database does the same here.
    await this.conn()
      .exec(this.dbName, "ROLLBACK", [])
      .catch(() => {
        /* nothing was open */
      });
  }

  async close(): Promise<void> {
    // The runner owns the database's lifetime — it outlives this page on
    // purpose, so the index stays warm across the surfaces of one capture.
  }

  async execute(query: string, params?: unknown[] | Record<string, unknown>): Promise<void> {
    await this.conn().exec(this.dbName, query, toPositional(params));
  }

  async query<T = unknown>(query: string, params?: unknown[] | Record<string, unknown>): Promise<T[]> {
    return (await this.conn().all(this.dbName, query, toPositional(params))) as T[];
  }

  async queryOne<T = unknown>(query: string, params?: unknown[] | Record<string, unknown>): Promise<T | null> {
    const rows = await this.query<T>(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /** BEGIN, `work`, COMMIT — or ROLLBACK, and the error of `work`. */
  private async inOneTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.execute("BEGIN");
    let result: T;
    try {
      result = await work();
    } catch (err) {
      await this.execute("ROLLBACK").catch(() => {
        /* connection state wins; surface the original error */
      });
      throw err;
    }
    try {
      await this.execute("COMMIT");
    } catch (err) {
      // What a failed COMMIT left open must not ride into the next turn.
      await this.execute("ROLLBACK").catch(() => {});
      throw err;
    }
    return result;
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.turns.take(() =>
      this.inOneTransaction(async () => {
        this.inTransaction = true;
        try {
          return await fn();
        } finally {
          this.inTransaction = false;
        }
      }),
    );
  }

  /**
   * A transaction of its own, in its turn — except for the batch its caller
   * sends from inside the body of its own `transaction()` and says so (the
   * indexer's full scan): that one runs in the transaction that is open.
   */
  async runBatch(statements: BatchStatement[], options?: BatchOptions): Promise<void> {
    if (statements.length === 0) return;
    const run = async () => {
      for (const s of statements) await this.execute(s.sql, s.params);
    };
    if (options?.inOpenTransaction && this.inTransaction) await run();
    else await this.turns.take(() => this.inOneTransaction(run));
  }
}
