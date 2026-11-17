import { createRequire } from "node:module";
// jsdom runs through Vite's client resolver, which does not recognize the
// experimental SQLite builtin on Node 22. Load it through Node itself.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../../src/db/Schema.js";

/**
 * How long a write sent to the adapter itself waits for an open transaction
 * before the test is told it waits for its own body (D3).
 */
export const STATEMENT_WAITS_MS = 2_000;

/**
 * One in-memory SQLite connection with real transactions. A second
 * transaction opened while one is open is refused by SQLite itself, as it
 * always was here. What the phone's adapter does with a single write
 * (`CapacitorSqliteAdapter`, Datensicherheit D3) it does here too: a
 * transaction's body runs its statements through the handle it is given, and
 * a write sent to the adapter itself waits for the transaction that is open
 * and then runs on its own — never inside it. A write that waits longer than
 * `STATEMENT_WAITS_MS` fails and names where that transaction was opened: a
 * body that sends a write to the adapter instead of its handle waits for
 * itself. Reads take no turn, as on the phone.
 */
export async function realSqlite(): Promise<IDatabaseAdapter> {
  const sqlite = new DatabaseSync(":memory:");
  /** The transaction that is open: where it was opened, and its end. */
  let open: { opener: string; ended: Promise<void> } | null = null;
  const run = (sql: string, params: unknown[] = []) => { sqlite.prepare(sql).run(...params as never[]); };
  const all = <T>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).all(...params as never[]) as T[];
  const one = <T>(sql: string, params: unknown[] = []) => (sqlite.prepare(sql).get(...params as never[]) as T) ?? null;
  const db: IDatabaseAdapter = {
    async initialize() {},
    async close() { sqlite.close(); },
    async execute(sql, params = []) {
      const asked = Date.now();
      while (open) {
        const waitingFor = open;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const left = STATEMENT_WAITS_MS - (Date.now() - asked);
        const outcome = await Promise.race([
          waitingFor.ended.then(() => "ended" as const),
          new Promise<"waited out">((resolve) => { timer = setTimeout(() => resolve("waited out"), Math.max(0, left)); }),
        ]);
        clearTimeout(timer);
        if (outcome === "waited out") {
          throw new Error(
            `A statement sent to the database adapter waited ${STATEMENT_WAITS_MS} ms for the transaction opened ${waitingFor.opener}. ` +
            "A transaction's body that sends its statements to the adapter instead of its handle (tx) waits for itself.",
          );
        }
      }
      run(sql, params as unknown[]);
    },
    async query<T>(sql: string, params: unknown[] = []) { return all<T>(sql, params); },
    async queryOne<T>(sql: string, params: unknown[] = []) { return one<T>(sql, params); },
    async transaction<T>(fn: (tx: SqlStatements) => Promise<T>) {
      const opener = (new Error().stack ?? "").split(/\r?\n/).slice(2).map((line) => line.trim())
        .find((line) => !line.includes("realSqlite")) ?? "somewhere";
      // Refused by SQLite while one is open, as before.
      sqlite.exec("BEGIN");
      let end!: () => void;
      const mine = { opener, ended: new Promise<void>((resolve) => { end = resolve; }) };
      open = mine;
      let live = true;
      const check = () => {
        if (!live) throw new Error("This transaction is over: its handle runs no more statements");
      };
      const tx: SqlStatements = {
        async execute(sql, params = []) { check(); run(sql, params as unknown[]); },
        async query<R>(sql: string, params: unknown[] = []) { check(); return all<R>(sql, params); },
        async queryOne<R>(sql: string, params: unknown[] = []) { check(); return one<R>(sql, params); },
      };
      const finish = () => {
        live = false;
        if (open === mine) open = null;
        end();
      };
      try {
        const result = await fn(tx);
        sqlite.exec("COMMIT");
        finish();
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        finish();
        throw error;
      }
    },
  };
  await initializeSchema(db);
  return db;
}

/**
 * Lets a test step in around every write to `db` — one sent to the adapter
 * and one of a transaction's body through its handle (D3). `write` runs the
 * statement with `run`, or refuses it by throwing. A batch is announced
 * statement by statement and then run as a whole. Returns what undoes it.
 */
export function onEveryWrite(
  db: IDatabaseAdapter,
  write: (sql: string, params: unknown[], run: () => Promise<void>) => Promise<void>,
): () => void {
  const { execute, transaction, runBatch } = db;
  const params = (p: unknown) => (Array.isArray(p) ? p : []);
  const batch = async (statements: BatchStatement[], send: (statements: BatchStatement[]) => Promise<void>) => {
    for (const s of statements) await write(s.sql, params(s.params), async () => {});
    await send(statements);
  };
  db.execute = (sql, p) => write(sql, params(p), () => execute.call(db, sql, p));
  db.transaction = <T,>(fn: (tx: SqlStatements) => Promise<T>) => transaction.call(db, (tx: SqlStatements) => fn(tx === db ? tx : {
    execute: (sql, p) => write(sql, params(p), () => tx.execute(sql, p)),
    query: (sql, p) => tx.query(sql, p),
    queryOne: (sql, p) => tx.queryOne(sql, p),
    ...(tx.runBatch ? { runBatch: (statements: BatchStatement[]) => batch(statements, (all) => tx.runBatch!(all)) } : {}),
  })) as Promise<T>;
  if (runBatch) db.runBatch = (statements) => batch(statements, (all) => runBatch.call(db, all));
  return () => {
    db.execute = execute;
    db.transaction = transaction;
    if (runBatch) db.runBatch = runBatch;
  };
}

/** `onEveryWrite`, for a test that only refuses: `before` throws, or the write runs. */
export function beforeEveryWrite(
  db: IDatabaseAdapter,
  before: (sql: string, params: unknown[]) => void | Promise<void>,
): () => void {
  return onEveryWrite(db, async (sql, params, run) => {
    await before(sql, params);
    await run();
  });
}

/**
 * Runs `work` once inside the next transaction that writes — the full scan's,
 * as it writes the rows of what it read: what the scan found is noted by
 * then. The scan reads its files ahead and outside its transactions
 * (performance plan L2), so a read is no moment inside one any more. Returns
 * whether `work` has run.
 */
export function atTheNextTransactionWrite(db: IDatabaseAdapter, work: () => Promise<unknown>): () => boolean {
  const open = db.transaction;
  let fired = false;
  db.transaction = <T,>(fn: (tx: SqlStatements) => Promise<T>) => open.call(db, (tx: SqlStatements) => fn(fired ? tx : new Proxy(tx, {
    get(inner, prop, receiver) {
      const value = Reflect.get(inner, prop, receiver);
      if (typeof value !== "function") return value;
      if (fired || (prop !== "runBatch" && prop !== "execute")) return value.bind(inner);
      return async (...args: unknown[]) => {
        if (!fired) {
          fired = true;
          await work();
        }
        return value.apply(inner, args);
      };
    },
  }))) as Promise<T>;
  return () => fired;
}
