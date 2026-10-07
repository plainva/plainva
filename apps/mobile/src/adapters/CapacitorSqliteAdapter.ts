import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { BatchStatement, IDatabaseAdapter } from "@plainva/core";

/**
 * IDatabaseAdapter over @capacitor-community/sqlite (M2). Unlike the desktop
 * Tauri adapter (sqlx pool, no real SQL transactions), this is a single
 * native connection, so transaction() maps to real BEGIN/COMMIT/ROLLBACK.
 * On the plain web dev server the plugin has no backing store — initialize()
 * throws and the app runs without an index (search disabled) until it runs
 * natively.
 */
export class CapacitorSqliteAdapter implements IDatabaseAdapter {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;

  constructor(private readonly dbName: string) {}

  /** Removes a per-vault database file (vault deletion). Best effort. */
  static async deleteDatabase(dbName: string): Promise<void> {
    await CapacitorSQLite.deleteDatabase({ database: dbName });
  }

  async initialize(): Promise<void> {
    const consistency = await this.sqlite.checkConnectionsConsistency();
    const existing = await this.sqlite.isConnection(this.dbName, false);
    this.db =
      consistency.result && existing.result
        ? await this.sqlite.retrieveConnection(this.dbName, false)
        : await this.sqlite.createConnection(this.dbName, false, "no-encryption", 1, false);
    await this.db.open();
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.db.close();
    await this.sqlite.closeConnection(this.dbName, false);
    this.db = null;
  }

  private conn(): SQLiteDBConnection {
    if (!this.db) throw new Error("database not initialized");
    return this.db;
  }

  async execute(query: string, params?: any[] | Record<string, any>): Promise<void> {
    await this.conn().run(query, toPositional(params), false);
  }

  async query<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T[]> {
    const res = await this.conn().query(query, toPositional(params));
    return (res.values ?? []) as T[];
  }

  async queryOne<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T | null> {
    const rows = await this.query<T>(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /** Open `transaction()` calls. `runBatch` reads it: see there. */
  private depth = 0;

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.conn();
    await db.beginTransaction();
    this.depth += 1;
    try {
      const result = await fn();
      this.depth -= 1;
      await db.commitTransaction();
      return result;
    } catch (err) {
      this.depth -= 1;
      try {
        await db.rollbackTransaction();
      } catch {
        /* connection state wins; surface the original error */
      }
      throw err;
    }
  }

  /**
   * An ordered batch of writes as ONE native call (plan Befunde 2026-10-06,
   * K1).
   *
   * `transaction()` above is a real transaction, but it is not what keeps a
   * READER out: this is a single connection, and a query that another part of
   * the app sends between two of the batch's statements runs on that same
   * connection and sees the half-finished state — a calendar whose events were
   * deleted and not yet written back. `executeSet` hands the whole list to
   * the plugin at once; it begins, runs every statement and commits (or rolls
   * back on the first error) before the next call from JavaScript is served.
   *
   * Inside an open `transaction()` — the indexer flushes its batches there —
   * nothing changes: SQLite has no nested transactions, so the statements run
   * one by one in the transaction that is open, exactly as they did before
   * this method existed, and are committed or rolled back with it. That keeps
   * the indexer's write path untouched; the price is that a batch arriving
   * from elsewhere while a scan holds its transaction is not a single call.
   */
  async runBatch(statements: BatchStatement[]): Promise<void> {
    if (statements.length === 0) return;
    if (this.depth > 0) {
      for (const s of statements) await this.execute(s.sql, s.params);
      return;
    }
    const set = statements.map((s) => ({ statement: s.sql, values: toPositional(s.params) }));
    await this.conn().executeSet(set, true);
  }
}

function toPositional(params?: any[] | Record<string, any>): any[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  return Object.values(params);
}
