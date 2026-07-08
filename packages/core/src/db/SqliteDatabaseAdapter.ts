import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { IDatabaseAdapter } from "./IDatabaseAdapter.js";

/**
 * A concrete database adapter using sqlite3 for desktop/server environments.
 */
export class SqliteDatabaseAdapter implements IDatabaseAdapter {
  private db: Database | null = null;

  /**
   * @param dbPath Path to the sqlite file. Use ":memory:" for an in-memory database.
   */
  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });
    // Enable WAL mode for better concurrency performance
    await this.db.exec("PRAGMA journal_mode = WAL");
    // Enable foreign keys
    await this.db.exec("PRAGMA foreign_keys = ON");
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private getDb(): Database {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  async execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    await this.getDb().run(query, params);
  }

  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    return await this.getDb().all(query, params);
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    const result = await this.getDb().get(query, params);
    return result ? (result as T) : null;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.getDb();
    await db.exec("BEGIN");
    try {
      const result = await fn();
      await db.exec("COMMIT");
      return result;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }
}
