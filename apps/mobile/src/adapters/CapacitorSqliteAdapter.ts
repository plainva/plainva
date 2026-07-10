import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { IDatabaseAdapter } from "@plainva/core";

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

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.conn();
    await db.beginTransaction();
    try {
      const result = await fn();
      await db.commitTransaction();
      return result;
    } catch (err) {
      try {
        await db.rollbackTransaction();
      } catch {
        /* connection state wins; surface the original error */
      }
      throw err;
    }
  }
}

function toPositional(params?: any[] | Record<string, any>): any[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  return Object.values(params);
}
