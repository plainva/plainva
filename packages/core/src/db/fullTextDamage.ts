import type { IDatabaseAdapter, SqlStatements } from "./IDatabaseAdapter.js";

/**
 * A damaged full-text index met while the vault is open.
 *
 * SQLite's SQLITE_CORRUPT_VTAB (267) for the FTS5 table does not show at the
 * open when the table's root pages are whole: it shows at a search (MATCH),
 * at a read of a note's text, and at a write — the indexer's, and the
 * triggers that remove a note's row. The rest of the database is not
 * affected. So whatever meets it notes it here, in `meta`, and the next open
 * makes only the full-text table anew (`initializeSchema`), as it does when
 * the damage shows at the open. Until then search finds nothing and says why
 * (`errorText`, `useSearchPages`).
 */
export const FULL_TEXT_DAMAGED_MARK = "full_text_damaged";

/** SQLITE_CORRUPT_VTAB as each driver says it: sqlx's code, the phone plugin's and SQLite's words, FTS5's own. */
export function isDamagedFullText(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error ?? "");
  return /\(code: 267\)|SQLITE_CORRUPT_VTAB|fts5: corruption/i.test(text);
}

/** Whether a damaged full-text index was noted and waits for the next open. */
export async function fullTextDamageNoted(db: SqlStatements): Promise<boolean> {
  const row = await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [FULL_TEXT_DAMAGED_MARK]).catch(() => null);
  return !!row;
}

const WATCHED = new Set(["execute", "query", "queryOne", "runBatch", "transaction"]);

/**
 * The database as the shell hands it on, noting a damaged full-text index
 * wherever a statement meets it: on the adapter itself, in a batch, and in a
 * transaction's body — there after the transaction is through, rolled back or
 * not, since a write to the adapter while it is open would wait for it. The
 * error itself goes on unchanged. `onNoted` hears of it once.
 */
export function watchFullTextDamage<T extends IDatabaseAdapter>(db: T, onNoted?: (error: unknown) => void): T {
  let noted = false;
  const note = async (error: unknown) => {
    if (noted) return;
    noted = true;
    try {
      await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [FULL_TEXT_DAMAGED_MARK, new Date().toISOString()]);
    } catch (failure) {
      // Not noted: the next statement that meets the damage tries again.
      noted = false;
      console.error("[index] noting the damaged full-text index failed", failure);
      return;
    }
    console.error("[index] the full-text index is damaged; it is made anew at the next open", error);
    onNoted?.(error);
  };
  const watched = <R>(run: () => Promise<R>): Promise<R> =>
    run().catch(async (error: unknown) => {
      if (isDamagedFullText(error)) await note(error);
      throw error;
    });
  const handle = (tx: SqlStatements, met: { error: unknown }): SqlStatements => {
    const seen = <R>(run: () => Promise<R>): Promise<R> =>
      run().catch((error: unknown) => {
        if (isDamagedFullText(error)) met.error ??= error;
        throw error;
      });
    return {
      execute: (sql, params) => seen(() => tx.execute(sql, params)),
      query: (sql, params) => seen(() => tx.query(sql, params)),
      queryOne: (sql, params) => seen(() => tx.queryOne(sql, params)),
      ...(tx.runBatch ? { runBatch: (statements) => seen(() => tx.runBatch!(statements)) } : {}),
    };
  };
  // Its own name: the transaction guard reads bodies by the name of what opens one.
  const transactionWatchingFullText = async <R>(fn: (tx: SqlStatements) => Promise<R>): Promise<R> => {
    const met: { error: unknown } = { error: undefined };
    try {
      return await db.transaction((tx) => fn(handle(tx, met)));
    } catch (error) {
      if (isDamagedFullText(error)) met.error ??= error;
      throw error;
    } finally {
      if (met.error !== undefined) await note(met.error);
    }
  };
  return new Proxy(db, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || !WATCHED.has(key) || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (key === "transaction") return transactionWatchingFullText;
      return (...args: unknown[]) => watched(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  });
}
