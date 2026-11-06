import type { SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "@plainva/core";
import { acquireDatabase, deleteDatabaseFile, releaseDatabase } from "./sqliteConnections";
import { TransactionTurns, takeStatement, transactionLabel } from "./transactionTurns";

/** How long `close()` waits for the transactions already asked for before it closes all the same. */
const CLOSE_WAITS_MS = 10_000;

/**
 * IDatabaseAdapter over @capacitor-community/sqlite (M2). Unlike the desktop
 * Tauri adapter (sqlx pool, no real SQL transactions), this is a single
 * native connection, so transaction() maps to real BEGIN/COMMIT/ROLLBACK.
 * On the plain web dev server the plugin has no backing store — initialize()
 * throws and the app runs without an index (search disabled) until it runs
 * natively.
 *
 * One connection means one transaction: the plugin refuses a second one while
 * one is open, so transactions — and batches, which are transactions of their
 * own — take turns here (transactionTurns.ts). So does a single write sent to
 * the adapter itself (Datensicherheit D3): on this connection it used to run
 * in whichever transaction was open, and was rolled back with it. A
 * transaction's body runs its statements through the handle it is given. The
 * connection and its turns come from `sqliteConnections.ts`, which every
 * database of the phone opens through: a second adapter on one name shares
 * both.
 */
export class CapacitorSqliteAdapter implements IDatabaseAdapter {
  private db: SQLiteDBConnection | null = null;
  private turns = new TransactionTurns();

  constructor(private readonly dbName: string) {}

  /** Removes a per-vault database file (vault deletion). Best effort. */
  static async deleteDatabase(dbName: string): Promise<void> {
    await deleteDatabaseFile(dbName);
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    const handle = await acquireDatabase(this.dbName);
    this.turns = handle.turns;
    this.db = handle.connection;
  }

  /**
   * Closes in its turn, after the transactions that were asked for before it:
   * an entry for the sync queue that waited for an index pass is written, not
   * cut off by the vault being switched. Whatever is asked for afterwards
   * finds the database closed. It does not wait for ever — a transaction that
   * never ends must not keep a vault from closing.
   */
  async close(): Promise<void> {
    if (!this.db) return;
    const shut = async () => {
      const db = this.db;
      if (!db) return;
      this.db = null;
      await releaseDatabase(this.dbName);
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
      await shut();
    } finally {
      clearTimeout(timer);
    }
  }

  private conn(): SQLiteDBConnection {
    if (!this.db) throw new Error("database not initialized");
    return this.db;
  }

  /** A write of its own, in its turn: after the transaction that is open, never inside it. */
  async execute(query: string, params?: any[] | Record<string, any>): Promise<void> {
    await takeStatement(this.turns, async () => {
      await this.conn().run(query, toPositional(params), false);
    });
  }

  /** A read takes no turn: nothing of it can be rolled back, and a search must not wait for a full scan. */
  async query<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T[]> {
    const res = await this.conn().query(query, toPositional(params));
    return (res.values ?? []) as T[];
  }

  async queryOne<T = any>(query: string, params?: any[] | Record<string, any>): Promise<T | null> {
    const rows = await this.query<T>(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * A real transaction, in its turn: it waits for the one that is open instead
   * of being refused by the plugin. Its body runs its statements through `tx`,
   * on the connection, inside this transaction; `tx` ends with the body. The
   * body must not open another transaction and wait for it, nor send a write
   * to the adapter itself — either would wait for this turn (transactionTurns.ts).
   */
  transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
    return this.turns.take(async () => {
      const db = this.conn();
      await db.beginTransaction();
      const handle = openHandle(db);
      let result: T;
      try {
        result = await fn(handle.tx);
      } catch (err) {
        handle.end();
        try {
          await db.rollbackTransaction();
        } catch {
          /* connection state wins; surface the original error */
        }
        throw err;
      }
      handle.end();
      try {
        await db.commitTransaction();
      } catch (err) {
        // Whatever the failed COMMIT left open must not ride into the next
        // turn. (On iOS a rollback without a transaction fails; that is fine.)
        try {
          await db.rollbackTransaction();
        } catch {
          /* nothing was open */
        }
        throw err;
      }
      return result;
    }, transactionLabel());
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
   * That native call is a transaction of its own, so it takes a turn like one
   * (finding 2026-10-12) and waits for a transaction that is open — a calendar
   * written while the index scans is still one call, after the scan. Sent
   * while another flow's `beginTransaction` was on its way, it used to meet
   * that transaction a moment later and be refused; and on Android the
   * plugin's `executeSet` then rolls back in its `finally` whatever
   * transaction is open, which was the other flow's — that flow ran on
   * outside any transaction and failed at its COMMIT.
   *
   * A batch from inside a transaction's body goes through its handle (`tx`),
   * which runs the statements one by one in that transaction (the indexer's
   * full scan flushes there). SQLite has no nested transactions.
   */
  async runBatch(statements: BatchStatement[]): Promise<void> {
    if (statements.length === 0) return;
    const set = statements.map((s) => ({ statement: s.sql, values: toPositional(s.params) }));
    await this.turns.take(async () => {
      await this.conn().executeSet(set, true);
    }, "batch");
  }
}

/**
 * The handle a transaction's body runs its statements through: straight on the
 * connection, inside the transaction that is open. Once the body has ended it
 * throws — a statement sent through it later would run outside any turn, in
 * whatever transaction is open then.
 */
function openHandle(db: SQLiteDBConnection): { tx: SqlStatements; end: () => void } {
  let open = true;
  const live = (): SQLiteDBConnection => {
    if (!open) throw new Error("This transaction is over: its handle runs no more statements");
    return db;
  };
  const query = async <T,>(sql: string, params?: any[] | Record<string, any>): Promise<T[]> =>
    ((await live().query(sql, toPositional(params))).values ?? []) as T[];
  const tx: SqlStatements = {
    async execute(sql, params) {
      await live().run(sql, toPositional(params), false);
    },
    query,
    async queryOne<T>(sql: string, params?: any[] | Record<string, any>) {
      const rows = await query<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    async runBatch(statements) {
      for (const s of statements) await live().run(s.sql, toPositional(s.params), false);
    },
  };
  return { tx, end: () => { open = false; } };
}

function toPositional(params?: any[] | Record<string, any>): any[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  return Object.values(params);
}
