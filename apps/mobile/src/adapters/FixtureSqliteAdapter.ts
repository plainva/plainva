import type { BatchStatement, IDatabaseAdapter } from "@plainva/core";

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
   * Nesting depth. SQLite has no nested transactions, and the callers do nest:
   * `runBatch` is invoked from inside `transaction()`, so an unconditional
   * BEGIN fails with "cannot start a transaction within a transaction" — and
   * because the boot swallows index errors, the app then simply runs on
   * without an index. That is precisely the silent hole this adapter exists to
   * close, so only the OUTERMOST call opens and commits.
   */
  private depth = 0;

  constructor(private readonly dbName: string) {}

  private conn(): FixtureSqlBridge {
    const b = bridge();
    if (!b) throw new Error("fixture sql bridge not installed");
    return b;
  }

  async initialize(): Promise<void> {
    // The runner opens the database; a round trip proves it answers.
    await this.conn().all(this.dbName, "SELECT 1", []);
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

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outermost = this.depth === 0;
    if (outermost) await this.execute("BEGIN");
    this.depth += 1;
    try {
      const result = await fn();
      this.depth -= 1;
      if (outermost) await this.execute("COMMIT");
      return result;
    } catch (err) {
      this.depth -= 1;
      if (outermost) {
        await this.execute("ROLLBACK").catch(() => {
          /* connection state wins; surface the original error */
        });
      }
      throw err;
    }
  }

  async runBatch(statements: BatchStatement[]): Promise<void> {
    await this.transaction(async () => {
      for (const s of statements) await this.execute(s.sql, s.params);
    });
  }
}
