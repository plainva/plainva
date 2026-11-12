import { BatchStatement, IDatabaseAdapter, SqlStatements } from "@plainva/core";
import { TransactionTurns, takeStatement, transactionLabel } from "@plainva/ui";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

/** How long `close()` waits for the transactions already asked for before it closes all the same (as on the phone). */
const CLOSE_WAITS_MS = 10_000;

/**
 * IDatabaseAdapter over the index database of the desktop.
 *
 * Reads and single writes go through the SQL plugin's connection pool. A
 * transaction is a REAL one since stability plan R1: the plugin's pool cannot
 * hold a `BEGIN` across calls (each call may get another connection), so a
 * transaction runs on one connection Rust holds for it (`src-tauri/src/db_tx.rs`:
 * `db_tx_begin`, statements by the transaction's number, `db_tx_commit` /
 * `db_tx_rollback`). A body that fails leaves nothing behind; a kill between
 * two of its statements leaves neither. It used to be a turn and nothing else:
 * every statement committed as it ran.
 *
 * Transactions take turns (`TransactionTurns`, shared with the phone), and so
 * do a single write and a batch sent to the adapter itself: sent while a
 * transaction is open, they would wait for its write lock on another
 * connection and fail after the busy timeout. A body runs its statements
 * through the handle it is given; a body that sends a write to the adapter
 * instead waits for itself and is told so (under the unit tests in seconds).
 * Reads take no turn and see what is committed (WAL): a search does not wait
 * for a full scan. Unlike the phone's single connection, a read sent to the
 * adapter while a transaction is open does not see that transaction's
 * uncommitted rows — only its body's handle does.
 */
export class TauriDatabaseAdapter implements IDatabaseAdapter {
  private db: Database | null = null;
  private readonly turns = new TransactionTurns();
  /** An auxiliary window's handle: it reads, and writes nothing (`attachReadOnly`). */
  private readOnly = false;
  /** The transaction Rust holds for this adapter now, if one is open. */
  private openTransaction: number | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = await Database.load(this.dbPath);

    // A ROLLBACK on the pool clears a transaction somebody once began through
    // the plugin (none does since R1: transactions run on their own
    // connection in Rust, and a webview that reloads has its open ones rolled
    // back there, `db_tx.rs`). It throws when nothing is open, which is normal.
    try {
      await this.db.execute("ROLLBACK;");
    } catch {
      // nothing was open
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
   * file is in WAL mode. Such a window's adapter refuses writes itself, and a
   * transaction there reads through the pool — it opens none in Rust (R1).
   */
  attachReadOnly(): void {
    this.db = Database.get(this.dbPath);
    this.readOnly = true;
  }

  /**
   * Closes the pool. OWNER ONLY.
   *
   * The pool is shared app-wide (see `attachReadOnly`), so `close` on the
   * connection string tears it down for EVERY window. An auxiliary window
   * calling this would kill the central window's index — it detaches instead
   * (`detach()`). It closes in its turn, after the transactions asked for
   * before it (as on the phone): an entry of the sync queue that waited for an
   * index pass is written, not cut off by the vault being switched. What is
   * asked for afterwards finds the database closed. It does not wait for
   * ever — a transaction that never ends must not keep a vault from closing.
   */
  async close(): Promise<void> {
    if (!this.db) return;
    const shut = async () => {
      const db = this.db;
      if (!db) return;
      this.db = null;
      await db.close();
      // And the connection Rust kept for this database's next transaction (R1).
      await invoke("db_tx_close", { dbPath: this.dbPath }).catch(() => {});
    };
    const inTurn = this.turns.take(shut, "close");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitedOut = new Promise<"waited out">((resolve) => {
      timer = setTimeout(() => resolve("waited out"), CLOSE_WAITS_MS);
    });
    try {
      if ((await Promise.race([inTurn, waitedOut])) !== "waited out") return;
      // Its turn, when it comes, finds nothing left to close.
      inTurn.catch(() => {});
      // The transaction that held the turn goes back now (review m2): it held
      // the write lock in Rust, and the same vault opened again meanwhile —
      // or the next one on the same file — met a locked database until the
      // reaper came. Its body learns of it at its next statement.
      const open = this.openTransaction;
      this.openTransaction = null;
      if (open !== null) await invoke("db_tx_rollback", { id: open }).catch(() => {});
      await shut();
    } finally {
      clearTimeout(timer);
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

  private refuseInReadOnly(): void {
    if (this.readOnly) throw new Error("This window reads the index and writes nothing to it");
  }

  /** A write of its own, in its turn: after the transaction that is open, never beside it. */
  async execute(query: string, params: any[] | Record<string, any> = []): Promise<void> {
    this.refuseInReadOnly();
    await takeStatement(this.turns, async () => {
      await this.getDb().execute(query, toPositional(params));
    });
  }

  /** A read takes no turn: it sees what is committed, and a search must not wait for a full scan. */
  async query<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T[]> {
    return await this.getDb().select<T[]>(query, toPositional(params));
  }

  async queryOne<T = any>(query: string, params: any[] | Record<string, any> = []): Promise<T | null> {
    const results = await this.query<T>(query, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * A real transaction, in its turn (R1). Its body runs its statements through
   * `tx`, on the connection Rust holds for it; `tx` ends with the body. A body
   * that throws is rolled back; a COMMIT that fails is rolled back on the Rust
   * side and throws here. The body must not open another transaction and wait
   * for it, nor send a write to the adapter itself — either would wait for
   * this turn.
   */
  transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
    if (this.readOnly) return this.turns.take(() => fn(this.readOnlyHandle()), transactionLabel());
    return this.turns.take(async () => {
      this.getDb();
      const id = await invoke<number>("db_tx_begin", { dbPath: this.dbPath });
      this.openTransaction = id;
      const handle = openHandle(id);
      let result: T;
      try {
        result = await fn(handle.tx);
      } catch (err) {
        handle.end();
        if (this.openTransaction === id) this.openTransaction = null;
        try {
          await invoke("db_tx_rollback", { id });
        } catch {
          /* gone already (its page reloaded, it sat idle, the database closed): nothing of it is kept either way */
        }
        throw err;
      }
      handle.end();
      try {
        await invoke("db_tx_commit", { id });
      } finally {
        if (this.openTransaction === id) this.openTransaction = null;
      }
      return result;
    }, transactionLabel());
  }

  /** What a transaction's body gets in an auxiliary window: reads through the pool, no writes. */
  private readOnlyHandle(): SqlStatements {
    const refuse = async (): Promise<never> => {
      throw new Error("This window reads the index and writes nothing to it");
    };
    return {
      execute: refuse,
      query: (sql, params) => this.query(sql, params),
      queryOne: (sql, params) => this.queryOne(sql, params),
      runBatch: refuse,
    };
  }

  /**
   * Runs an ordered batch of write statements as ONE atomic SQLite transaction
   * via the native `db_batch` command (BEGIN/COMMIT, ROLLBACK on error), in one
   * IPC hop. A batch of its own takes a turn like a transaction: sent while one
   * is open it would wait for that one's write lock. A batch from inside a
   * transaction's body goes through its handle and runs in that transaction
   * (`db_tx_batch`; the index's full scan flushes there).
   */
  async runBatch(statements: BatchStatement[]): Promise<void> {
    this.refuseInReadOnly();
    if (statements.length === 0) return;
    this.getDb();
    await this.turns.take(async () => {
      await invoke("db_batch", { dbPath: this.dbPath, statements: toWire(statements) });
    }, "batch");
  }
}

/**
 * The handle a transaction's body runs its statements through: by number, on
 * the connection Rust holds for the transaction. Once the body has ended it
 * throws — a statement sent through it later would find the transaction gone.
 */
function openHandle(id: number): { tx: SqlStatements; end: () => void } {
  let open = true;
  const live = (): number => {
    if (!open) throw new Error("This transaction is over: its handle runs no more statements");
    return id;
  };
  const query = async <T,>(sql: string, params?: any[] | Record<string, any>): Promise<T[]> =>
    await invoke<T[]>("db_tx_select", { id: live(), sql, params: toPositional(params) });
  const tx: SqlStatements = {
    async execute(sql, params) {
      await invoke("db_tx_execute", { id: live(), sql, params: toPositional(params) });
    },
    query,
    async queryOne<T>(sql: string, params?: any[] | Record<string, any>) {
      const rows = await query<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    async runBatch(statements) {
      const at = live();
      if (statements.length === 0) return;
      await invoke("db_tx_batch", { id: at, statements: toWire(statements) });
    },
  };
  return { tx, end: () => { open = false; } };
}

function toWire(statements: BatchStatement[]): Array<{ sql: string; params: unknown[] }> {
  return statements.map((s) => ({ sql: s.sql, params: s.params ?? [] }));
}

function toPositional(params?: any[] | Record<string, any>): any[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  return Object.values(params);
}
