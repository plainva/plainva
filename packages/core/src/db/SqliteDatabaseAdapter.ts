import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { IDatabaseAdapter, SqlStatements } from "./IDatabaseAdapter.js";

/**
 * A concrete database adapter using sqlite3 for desktop/server environments.
 *
 * One connection with real transactions, like the phone's: transactions take
 * turns, a write sent to the adapter itself waits for the transaction that is
 * open (it would otherwise run in it and be rolled back with it), and a body
 * runs its statements through the handle it is given (`IDatabaseAdapter.transaction`).
 */
export class SqliteDatabaseAdapter implements IDatabaseAdapter {
  private db: Database | null = null;
  /** The turn that ends last: transactions and writes to the adapter wait for it. */
  private last: Promise<unknown> = Promise.resolve();

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

  private turn<T>(work: () => Promise<T>): Promise<T> {
    const mine = this.last.then(work);
    this.last = mine.catch(() => {});
    return mine;
  }

  execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    return this.turn(async () => {
      await this.getDb().run(query, params);
    });
  }

  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    return await this.getDb().all(query, params);
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    const result = await this.getDb().get(query, params);
    return result ? (result as T) : null;
  }

  transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
    return this.turn(async () => {
      const db = this.getDb();
      let open = true;
      const live = (): Database => {
        if (!open) throw new Error("This transaction is over: its handle runs no more statements");
        return db;
      };
      const tx: SqlStatements = {
        execute: async (query, params = []) => { await live().run(query, params); },
        query: async (query, params = []) => live().all(query, params),
        queryOne: async (query, params = []) => (await live().get(query, params)) ?? null,
      };
      await db.exec("BEGIN");
      try {
        const result = await fn(tx);
        open = false;
        await db.exec("COMMIT");
        return result;
      } catch (e) {
        open = false;
        await db.exec("ROLLBACK");
        throw e;
      }
    });
  }
}
