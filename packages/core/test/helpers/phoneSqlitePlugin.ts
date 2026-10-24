import { createRequire } from "node:module";
// See realSqlite.ts: the builtin is loaded through Node itself.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * The phone's SQLite plugin (`@capacitor-community/sqlite` 8.1), as far as the
 * phone's database adapter talks to it — over a real SQLite, so that the
 * adapter under test is the shipped one and only the native side is stood in
 * for. What is modelled was read in the plugin's sources, not watched on a
 * device:
 *
 *  - ONE connection per database, and every call from JavaScript is served on
 *    one native thread in the order it was sent (Android: the bridge's
 *    `CapacitorPlugins` handler thread; iOS: its serial `bridge` queue). A
 *    call and its answer each cross the bridge, so a transaction spans many
 *    turns of the event loop and other flows get in between — the one thing
 *    `node:sqlite` alone, which answers at once, never shows.
 *  - A statement sent without a transaction of its own while one is open runs
 *    IN it: it reads what is not committed yet, and is committed or rolled
 *    back with it (`run(…, false)` and `query` go straight to the connection).
 *  - `beginTransaction` while one is open is refused. Android asks first and
 *    answers "Already in transaction" (`Database.beginTransaction`); iOS sends
 *    `BEGIN TRANSACTION` and hands back SQLite's own refusal.
 *  - `executeSet(…, true)` and `run(…, true)` begin a transaction of their
 *    own. Met by an open one, both platforms refuse — and Android then rolls
 *    back in its `finally` whatever transaction is open, which is the OTHER
 *    caller's (`Database.executeSet`: `if (transaction && _db.inTransaction())
 *    rollbackTransaction()`). iOS leaves that one alone.
 *  - `commitTransaction` without an open transaction fails on both; Android's
 *    `rollbackTransaction` without one answers as if it had worked, iOS's
 *    fails.
 */
export type PhonePlatform = "android" | "ios";

export interface HeldTransaction {
  /** Resolves once the transaction is open on the native side (its `beginTransaction` served). */
  opened: Promise<void>;
  /** Lets the answer to that `beginTransaction` through: the flow that asked goes on. */
  release(): void;
}

interface SetStatement {
  statement: string;
  values?: unknown[];
}

interface Connection {
  sqlite: InstanceType<typeof DatabaseSync>;
  /** A transaction is open on this connection. Kept here: `isTransaction` is younger than Node 22.0. */
  inTransaction: boolean;
}

const hop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createPhoneSqlitePlugin(platform: PhonePlatform = "android") {
  const connections = new Map<string, Connection>();
  const counts = {
    /** Transactions the native side opened for a `beginTransaction`. */
    begun: 0,
    /** A `beginTransaction`, or a set or a statement with a transaction of its own, met an open transaction. */
    refused: 0,
    /** Android only: a refused set or statement rolled back the transaction it met. */
    rolledBackAnother: 0,
    /** Transactions committed for a `commitTransaction`. */
    committed: 0,
    /** Transactions rolled back for a `rollbackTransaction`. */
    rolledBack: 0,
  };
  /** Every call in the order the native side served it. */
  const log: string[] = [];
  const state = { platform };
  let thread: Promise<unknown> = Promise.resolve();
  let hold: { opened: () => void; released: Promise<void> } | null = null;
  const failing = new Map<string, string>();

  /** One call: its turn on the native thread, and the way back. */
  function serve<T>(name: string, work: () => T, beforeAnswer?: () => Promise<void>): Promise<T> {
    const turn = thread.then(hop).then(() => {
      log.push(name);
      const failure = failing.get(name);
      if (failure !== undefined) {
        failing.delete(name);
        throw new Error(failure);
      }
      return work();
    });
    thread = turn.catch(() => {});
    return turn.then(async (answer) => {
      await beforeAnswer?.();
      await hop();
      return answer;
    });
  }

  function connection(name: string): Connection {
    const found = connections.get(name);
    if (!found) throw new Error(`No available connection for database ${name}`);
    return found;
  }

  const begin = (c: Connection) => { c.sqlite.exec("BEGIN"); c.inTransaction = true; };
  const end = (c: Connection, how: "COMMIT" | "ROLLBACK") => { c.inTransaction = false; c.sqlite.exec(how); };

  function refusal(c: Connection, what: string): Error {
    counts.refused += 1;
    if (state.platform === "android") return new Error(`Failed in ${what}Already in transaction`);
    try {
      c.sqlite.exec("BEGIN TRANSACTION");
    } catch (error) {
      return new Error(`Failed in ${what} Error beginTransaction: failed rc: 1 message: ${(error as Error).message}`);
    }
    throw new Error("the stand-in opened a transaction inside another one");
  }

  /** A set or a statement that brings a transaction of its own. */
  function withOwnTransaction<T>(c: Connection, what: string, work: () => T): T {
    if (c.inTransaction) {
      const error = refusal(c, what);
      if (state.platform === "android") {
        // `finally { if (_db != null && transaction && _db.inTransaction()) rollbackTransaction(); }`
        end(c, "ROLLBACK");
        counts.rolledBackAnother += 1;
      }
      throw error;
    }
    begin(c);
    try {
      const answer = work();
      end(c, "COMMIT");
      return answer;
    } catch (error) {
      if (c.inTransaction) end(c, "ROLLBACK");
      throw error;
    }
  }

  const bind = (values: unknown[] = []) => values.map((value) => (value === undefined ? null : value)) as never[];

  function connectionFor(name: string) {
    return {
      open: () => serve("open", () => {
        if (!connections.has(name)) connections.set(name, { sqlite: new DatabaseSync(":memory:"), inTransaction: false });
      }),
      close: () => serve("close", () => {
        // A closed connection takes its open transaction with it. The rows of
        // this stand-in live as long as the plugin object, as a file would.
        const c = connections.get(name);
        if (c?.inTransaction) end(c, "ROLLBACK");
      }),
      run: (statement: string, values?: unknown[], transaction = true) =>
        serve(transaction ? "run+tx" : "run", () => {
          const c = connection(name);
          const exec = () => void c.sqlite.prepare(statement).run(...bind(values));
          if (transaction) withOwnTransaction(c, "runSQL", exec);
          else exec();
          return { changes: { changes: 0, lastId: 0 } };
        }),
      query: (statement: string, values?: unknown[]) =>
        serve("query", () => ({ values: connection(name).sqlite.prepare(statement).all(...bind(values)) as unknown[] })),
      executeSet: (set: SetStatement[], transaction = true) =>
        serve(transaction ? "executeSet+tx" : "executeSet", () => {
          const c = connection(name);
          const exec = () => {
            for (const item of set) c.sqlite.prepare(item.statement).run(...bind(item.values));
          };
          if (transaction) withOwnTransaction(c, "executeSet", exec);
          else exec();
          return { changes: { changes: 0, lastId: 0 } };
        }),
      beginTransaction: () => {
        const held = hold;
        let mine = false;
        return serve(
          "begin",
          () => {
            const c = connection(name);
            if (c.inTransaction) throw refusal(c, "beginTransaction");
            begin(c);
            counts.begun += 1;
            if (held && hold === held) {
              hold = null;
              mine = true;
              held.opened();
            }
            return { changes: { changes: 0 } };
          },
          // The native side has moved on; it is the flow that asked which has not heard yet.
          async () => {
            if (mine) await held!.released;
          },
        );
      },
      commitTransaction: () =>
        serve("commit", () => {
          const c = connection(name);
          if (!c.inTransaction) {
            throw new Error(state.platform === "android"
              ? "Failed in commitTransactionNo transaction active"
              : "Failed in commitTransaction Error commitTransaction: failed rc: 1 message: cannot commit - no transaction is active");
          }
          end(c, "COMMIT");
          counts.committed += 1;
          return { changes: { changes: 0 } };
        }),
      rollbackTransaction: () =>
        serve("rollback", () => {
          const c = connection(name);
          if (!c.inTransaction) {
            if (state.platform === "android") return { changes: { changes: 0 } };
            throw new Error("Failed in rollbackTransaction Error rollbackTransaction: failed rc: 1 message: cannot rollback - no transaction is active");
          }
          end(c, "ROLLBACK");
          counts.rolledBack += 1;
          return { changes: { changes: 0 } };
        }),
      isTransactionActive: () => serve("isTransactionActive", () => ({ result: connection(name).inTransaction })),
    };
  }

  class SQLiteConnection {
    async checkConnectionsConsistency() {
      return { result: false };
    }
    async isConnection() {
      return { result: false };
    }
    async createConnection(name: string) {
      return connectionFor(name);
    }
    async retrieveConnection(name: string) {
      return connectionFor(name);
    }
    async closeConnection() {}
  }

  return {
    /** What stands in for the module `@capacitor-community/sqlite`. */
    module: { CapacitorSQLite: { deleteDatabase: async () => {} }, SQLiteConnection },
    counts,
    log,
    /** Which platform's plugin answers from here on. */
    as(next: PhonePlatform) {
      state.platform = next;
    },
    /**
     * The next transaction that opens stays open until `release()`: the native
     * side serves every other call meanwhile, as it does while the flow that
     * opened the transaction reads a file or parses a note between two of its
     * statements.
     */
    holdNextTransaction(): HeldTransaction {
      let opened!: () => void;
      let release!: () => void;
      const whenOpened = new Promise<void>((resolve) => { opened = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      hold = { opened, released };
      return { opened: whenOpened, release };
    },
    /**
     * The next call of this kind (a name as `log` has it: "begin", "commit",
     * "run", …) fails without doing its work — a COMMIT that fails this way
     * leaves its transaction open, as a full disk would.
     */
    failNext(name: string, message = "disk I/O error") {
      failing.set(name, message);
    },
    /** Whether a transaction is open on the native side right now. */
    inTransaction: (name: string) => connections.get(name)?.inTransaction ?? false,
    /** A new, empty plugin: every database gone, every count at zero. */
    reset(next: PhonePlatform = "android") {
      for (const c of connections.values()) c.sqlite.close();
      connections.clear();
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0;
      log.length = 0;
      state.platform = next;
      thread = Promise.resolve();
      hold = null;
      failing.clear();
    },
  };
}

export type PhoneSqlitePlugin = ReturnType<typeof createPhoneSqlitePlugin>;

/** The one plugin a test file mocks the module with and steers from its tests. */
export const phoneSqlite = createPhoneSqlitePlugin();
