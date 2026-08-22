import { BatchStatement, IDatabaseAdapter } from "@plainva/core";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

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

  /**
   * Attaches to the database WITHOUT opening a second connection — what an
   * auxiliary window gets (multi-window P0, client mode).
   *
   * `Database.get()` rather than `Database.load()`, and that is not a
   * micro-optimization. The sql plugin keeps ONE app-wide map of pools keyed by
   * the connection string (`DbInstances(RwLock<HashMap<String, DbPool>>)`,
   * plugin 2.4.0), and its `load` command does `instances.insert(db, pool)`:
   * a second window calling `load` on the same URL builds a second pool and
   * REPLACES the owner's entry, after which every query from BOTH windows runs
   * through the newcomer's pool while the owner's is dropped mid-flight.
   * `get` only constructs the JS wrapper and defers to whatever pool is
   * registered — the owner's. If the owner has not opened this vault, the first
   * query fails loudly with `DatabaseNotLoaded`, which is the correct answer for
   * a window that only exists as part of an open vault.
   *
   * `initialize()` above also does three things a second window must not do: a
   * ROLLBACK that would clear a dangling transaction belonging to the owner, and
   * PRAGMAs that are either already persisted in the file (journal_mode) or only
   * matter to a writer (synchronous, foreign_keys). The aux capability grants
   * `sql:default` and deliberately NOT `sql:allow-execute`, so a client window
   * cannot write to the index at all. Reading concurrently is safe because the
   * file is in WAL mode.
   */
  attachReadOnly(): void {
    this.db = Database.get(this.dbPath);
  }

  /**
   * Closes the pool. OWNER ONLY.
   *
   * The pool is shared app-wide (see `attachReadOnly`), so `close` on the
   * connection string tears it down for EVERY window. An auxiliary window
   * calling this would kill the central window's index — it detaches instead
   * (`detach()`).
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  /** Drops this window's handle without touching the shared pool. */
  detach(): void {
    this.db = null;
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

  /**
   * Runs an ordered batch of write statements as ONE atomic SQLite transaction
   * via the native `db_batch` command (BEGIN/COMMIT, ROLLBACK on error). It opens
   * its own short-lived connection to the same DB file — safe under WAL — so a
   * whole cold-index worth of writes travels in a single IPC hop instead of one
   * execute() per row. Serialized with `transaction()` by callers that hold the
   * JS mutex around the flush; on any failure the native side rolls back and this
   * throws (callers fall back to per-statement writes via runStatementsAtomic).
   */
  async runBatch(statements: BatchStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await invoke("db_batch", {
      dbPath: this.dbPath,
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
  }
}
