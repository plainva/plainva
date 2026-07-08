import { IDatabaseAdapter } from "@plainva/core";
import Database from "@tauri-apps/plugin-sql";

export class TauriDatabaseAdapter implements IDatabaseAdapter {
  private db: Database | null = null;
  
  private transactionQueue: (() => void)[] = [];
  private isTransactionLocked = false;

  private async acquireLock(): Promise<() => void> {
    if (!this.isTransactionLocked) {
      this.isTransactionLocked = true;
      return () => this.releaseLock();
    }
    return new Promise(resolve => {
      this.transactionQueue.push(() => resolve(() => this.releaseLock()));
    });
  }

  private releaseLock() {
    if (this.transactionQueue.length > 0) {
      const next = this.transactionQueue.shift()!;
      next();
    } else {
      this.isTransactionLocked = false;
    }
  }

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = await Database.load(this.dbPath);
    
    // In Tauri, the Rust backend caches database connections.
    // If a hot-reload or crash happens during an active transaction, 
    // the SQLite connection is left in a dangling transaction state.
    // We attempt a ROLLBACK here to clean up any such state.
    try {
      await this.db.execute("ROLLBACK;");
    } catch {
      // Ignore error: throws if no transaction is active (which is normal)
    }

    await this.db.execute("PRAGMA journal_mode = WAL;");
    await this.db.execute("PRAGMA synchronous = NORMAL;");
    await this.db.execute("PRAGMA foreign_keys = ON;");
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private getDb(): Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  async execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    await this.getDb().execute(query, params as unknown[]);
  }

  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    return await this.getDb().select<T[]>(query, params as unknown[]);
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    const results = await this.getDb().select<T[]>(query, params as unknown[]);
    return results.length > 0 ? results[0] : null;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const unlock = await this.acquireLock();
    try {
      // tauri-plugin-sql uses an sqlx connection pool under the hood.
      // We cannot safely use BEGIN TRANSACTION across multiple async invoke() calls 
      // because each call might check out a different connection from the pool, 
      // or return a dirty connection to the pool.
      // Therefore, we rely purely on the JS Mutex to serialize operations and 
      // let SQLite handle auto-commit per statement. Performance is still good 
      // due to WAL mode.
      return await fn();
    } finally {
      unlock();
    }
  }
}
