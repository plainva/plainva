import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// See realSqlite.ts: the builtin is loaded through Node itself.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * The desktop's native side of the index database, as far as
 * `TauriDatabaseAdapter` talks to it — over a real SQLite FILE in WAL mode,
 * with a connection of its own for every party, so that the adapter under test
 * is the shipped one and only the native side is stood in for:
 *
 *  - `@tauri-apps/plugin-sql` (`module.sql`): the plugin's pool. Each
 *    statement commits as it runs (no `BEGIN` holds across calls there). The
 *    pool is one connection here; a statement that meets another connection's
 *    write lock fails at once with SQLite's "database is locked" (the real pool
 *    waits its busy timeout first, and then fails the same way).
 *  - `invoke` (`module.invoke`): `db_batch` (a short-lived connection, one
 *    transaction) and the transaction commands of `src-tauri/src/db_tx.rs` —
 *    `db_tx_begin` opens a connection and sends `BEGIN IMMEDIATE`, statements
 *    go to it by number, `db_tx_commit` / `db_tx_rollback` end it. A BEGIN
 *    that meets another writer fails at once ("database is locked").
 *
 * Every call crosses the bridge (one turn of the event loop each way), so a
 * transaction spans many turns and other flows get in between, as in the app.
 *
 * `endProcessAfter(test)` ends "the process" right after the first statement
 * that matches: every connection closes without a COMMIT (SQLite takes back
 * what was not committed), and no call is answered any more. `restart()` is
 * the next start: the same file, a new process.
 */
type Conn = InstanceType<typeof DatabaseSync>;

const hop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createDesktopSqlite() {
  let dir = mkdtempSync(join(tmpdir(), "plainva-desktop-db-"));
  let file = join(dir, "index.db");
  const open = (): Conn => {
    const c = new DatabaseSync(file, { timeout: 0 });
    c.exec("PRAGMA foreign_keys = ON");
    return c;
  };
  let generation = 0;
  let pool: Conn | null = null;
  const held = new Map<number, Conn>();
  let next = 0;
  let endAfter: ((sql: string) => boolean) | null = null;
  let ended = false;
  let endedNow: () => void = () => {};
  let whenEnded = new Promise<void>((resolve) => { endedNow = resolve; });
  /** Every call in the order the native side served it. */
  const log: string[] = [];

  const params = (values: unknown[] = []) => values.map((v) => (typeof v === "boolean" ? Number(v) : v)) as never[];
  const run = (c: Conn, sql: string, values?: unknown[]) => c.prepare(sql).run(...params(values));
  const all = (c: Conn, sql: string, values?: unknown[]) => c.prepare(sql).all(...params(values)).map((row) => ({ ...row }));

  function endProcess(): void {
    ended = true;
    endedNow();
    for (const c of held.values()) c.close();
    held.clear();
    pool?.close();
    pool = null;
  }

  /** One call over the bridge; once the process ended, nothing answers. */
  async function serve<T>(name: string, work: () => T, sql?: string): Promise<T> {
    const mine = generation;
    await hop();
    if (ended || mine !== generation) return new Promise<T>(() => {});
    log.push(name);
    const answer = work();
    if (sql !== undefined && endAfter?.(sql)) {
      endAfter = null;
      endProcess();
      return new Promise<T>(() => {});
    }
    await hop();
    return answer;
  }

  const poolConn = (): Conn => {
    if (!pool) throw new Error("Database not loaded");
    return pool;
  };
  const tx = (id: number): Conn => {
    const c = held.get(id);
    if (!c) throw new Error("This transaction is over (it is not open); nothing of it was kept");
    return c;
  };

  class Database {
    static async load(_url: string): Promise<Database> {
      return serve("load", () => {
        if (!pool) pool = open();
        return new Database();
      });
    }
    static get(_url: string): Database {
      return new Database();
    }
    async execute(sql: string, values?: unknown[]): Promise<unknown> {
      return serve("execute", () => {
        const c = poolConn();
        // The plugin's pool holds no transaction: a ROLLBACK there finds none.
        if (/^\s*ROLLBACK/i.test(sql)) throw new Error("cannot rollback - no transaction is active");
        run(c, sql, values);
        return { rowsAffected: 1 };
      }, sql);
    }
    async select<T>(sql: string, values?: unknown[]): Promise<T> {
      return serve("select", () => all(poolConn(), sql, values) as T);
    }
    async close(): Promise<boolean> {
      return serve("close", () => {
        pool?.close();
        pool = null;
        return true;
      });
    }
  }

  async function invoke<T>(command: string, args: Record<string, any>): Promise<T> {
    switch (command) {
      case "db_batch":
        return serve(command, () => {
          const c = open();
          try {
            c.exec("BEGIN");
            try {
              for (const s of args.statements) run(c, s.sql, s.params);
              c.exec("COMMIT");
            } catch (error) {
              c.exec("ROLLBACK");
              throw error;
            }
          } finally {
            c.close();
          }
          return args.statements.length as T;
        }, args.statements.at(-1)?.sql);
      case "db_tx_begin":
        return serve(command, () => {
          const c = open();
          try {
            c.exec("BEGIN IMMEDIATE");
          } catch (error) {
            c.close();
            throw error;
          }
          next += 1;
          held.set(next, c);
          return next as T;
        });
      case "db_tx_execute":
        return serve(command, () => Number(run(tx(args.id), args.sql, args.params).changes) as T, args.sql);
      case "db_tx_select":
        return serve(command, () => all(tx(args.id), args.sql, args.params) as T);
      case "db_tx_batch":
        return serve(command, () => {
          const c = tx(args.id);
          for (const s of args.statements) {
            run(c, s.sql, s.params);
            if (endAfter?.(s.sql)) {
              endAfter = null;
              endProcess();
              break;
            }
          }
          return args.statements.length as T;
        });
      case "db_tx_commit":
        return serve(command, () => {
          const c = tx(args.id);
          held.delete(args.id);
          try {
            c.exec("COMMIT");
          } catch (error) {
            try { c.exec("ROLLBACK"); } catch { /* nothing open */ }
            throw error;
          } finally {
            c.close();
          }
          return undefined as T;
        });
      case "db_tx_close":
        return serve(command, () => undefined as T);
      case "db_tx_rollback":
        return serve(command, () => {
          const c = held.get(args.id);
          if (c) {
            held.delete(args.id);
            c.exec("ROLLBACK");
            c.close();
          }
          return undefined as T;
        });
      default:
        throw new Error(`no stand-in for ${command}`);
    }
  }

  return {
    module: { sql: { default: Database }, invoke },
    log,
    /** Transactions open on the native side. */
    openTransactions: () => held.size,
    /** Ends the process right after the first statement `test` matches; resolves once it has. */
    endProcessAfter(test: (sql: string) => boolean): Promise<void> {
      endAfter = test;
      return whenEnded;
    },
    /** The next start: the same file, a new process. Nothing of the last one answers any more. */
    restart() {
      if (!ended) endProcess();
      ended = false;
      whenEnded = new Promise<void>((resolve) => { endedNow = resolve; });
      generation += 1;
    },
    /** Another program takes the write lock of the file; the returned function lets it go. */
    holdWriteLock(): () => void {
      const c = open();
      c.exec("BEGIN IMMEDIATE");
      return () => { c.exec("ROLLBACK"); c.close(); };
    },
    /** What another program, or the next start, finds in the file. */
    read<T>(sql: string, values?: unknown[]): T[] {
      const c = open();
      try {
        return all(c, sql, values) as T[];
      } finally {
        c.close();
      }
    },
    reset() {
      endProcess();
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "plainva-desktop-db-"));
      file = join(dir, "index.db");
      ended = false;
      whenEnded = new Promise<void>((resolve) => { endedNow = resolve; });
      generation += 1;
      endAfter = null;
      log.length = 0;
    },
  };
}

export const desktopSqlite = createDesktopSqlite();
