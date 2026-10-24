import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { BatchOptions, BatchStatement, IDatabaseAdapter } from "@plainva/core";
import { TransactionTurns } from "./transactionTurns";

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
 * own — take turns here (transactionTurns.ts).
 */
export class CapacitorSqliteAdapter implements IDatabaseAdapter {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private readonly turns = new TransactionTurns();
  /** The body of a `transaction()` is running, between its BEGIN and its COMMIT or ROLLBACK. `runBatch` reads it. */
  private inTransaction = false;

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
      await db.close();
      await this.sqlite.closeConnection(this.dbName, false);
    };
    const inTurn = this.turns.take(shut);
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

  /**
   * A real transaction, in its turn: it waits for the one that is open instead
   * of being refused by the plugin. Its body must not open another one and
   * wait for it — that one would wait for this turn (transactionTurns.ts).
   */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.turns.take(async () => {
      const db = this.conn();
      await db.beginTransaction();
      this.inTransaction = true;
      let result: T;
      try {
        result = await fn();
      } catch (err) {
        this.inTransaction = false;
        try {
          await db.rollbackTransaction();
        } catch {
          /* connection state wins; surface the original error */
        }
        throw err;
      }
      this.inTransaction = false;
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
    });
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
   * The one batch that is NOT a turn is the one its caller sends from inside
   * the body of its own `transaction()` and says so (`inOpenTransaction`; the
   * indexer's full scan flushes there). SQLite has no nested transactions:
   * its statements run one by one in the transaction that is open and are
   * committed or rolled back with it. Without that word such a batch would
   * wait for the turn its own caller holds.
   */
  async runBatch(statements: BatchStatement[], options?: BatchOptions): Promise<void> {
    if (statements.length === 0) return;
    if (options?.inOpenTransaction && this.inTransaction) {
      for (const s of statements) await this.execute(s.sql, s.params);
      return;
    }
    const set = statements.map((s) => ({ statement: s.sql, values: toPositional(s.params) }));
    await this.turns.take(async () => {
      await this.conn().executeSet(set, true);
    });
  }
}

function toPositional(params?: any[] | Record<string, any>): any[] {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  return Object.values(params);
}
