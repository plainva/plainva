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
 *
 * A note never keeps a vault from opening: where making the table anew fails
 * too (a destroyed page of the table's own storage, which `DROP TABLE` must
 * read), the vault opens as it would without the note, without search, and
 * the note says that the attempt failed (`FullTextDamage`), so the search
 * can name the way that helps.
 */
export const FULL_TEXT_DAMAGED_MARK = "full_text_damaged";

/**
 * SQLITE_CORRUPT_VTAB as each driver says it: sqlx's code (desktop), the
 * extended code's name (Android), and FTS5's own words, which are all that
 * reach the phone's plugin on iOS — it passes on `sqlite3_errmsg` with the
 * primary code only (`rc: 11`).
 */
export function isDamagedFullText(error: unknown): boolean {
  return /\(code: 267\)|SQLITE_CORRUPT_VTAB|fts5: (?:corruption found|missing row|checksum mismatch)/i.test(errorWords(error));
}

/**
 * A damaged page somewhere, said without naming the table (SQLITE_CORRUPT, 11,
 * and its words): on iOS also what a damaged full-text index says. Which it
 * is, only a look at the full-text index itself tells (`fullTextIsDamaged`).
 */
function isDamagedPage(error: unknown): boolean {
  return /\(code: 11\)|\brc: 11\b|SQLITE_CORRUPT\b|database disk image is malformed/i.test(errorWords(error));
}

function errorWords(error: unknown): string {
  return error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error ?? "");
}

const NAMES_FULL_TEXT = /\bfts_notes\b/;

/**
 * Whether the full-text index itself is damaged: FTS5's own check reads all of
 * it and nothing else. It answers a damaged page met by a statement that
 * reaches the full-text index — that page may as well be one of the notes'
 * table it joins, and a damaged main table is no damaged full-text index.
 * `null`: the check could not run (a read-only window), so nothing is known.
 */
async function fullTextIsDamaged(db: SqlStatements): Promise<boolean | null> {
  try {
    await db.execute(`INSERT INTO fts_notes(fts_notes) VALUES ('integrity-check')`);
    return false;
  } catch (error) {
    if (isDamagedFullText(error) || isDamagedPage(error)) return true;
    return null;
  }
}

/** What a noted damage says: waiting for the next open, or that open's attempt failed (and how often, and why). */
export type FullTextDamage =
  | { state: "none" }
  | { state: "noted"; at: string }
  | { state: "rebuild-failed"; at: string; failures: number; reason: string };

interface MarkValue {
  at: string;
  failed?: { at: string; count: number; reason: string };
}

function markValue(raw: unknown): MarkValue | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MarkValue>;
    if (parsed && typeof parsed.at === "string") return parsed as MarkValue;
  } catch {
    // A note of an earlier form: the moment alone.
  }
  return { at: raw };
}

/** What `meta` holds about a damaged full-text index. */
export async function readFullTextDamage(db: SqlStatements): Promise<FullTextDamage> {
  const row = await db.queryOne<{ key: string; value: string }>(`SELECT key, value FROM meta WHERE key = ?`, [FULL_TEXT_DAMAGED_MARK]).catch(() => null);
  const mark = row && row.key === FULL_TEXT_DAMAGED_MARK ? markValue(row.value) : null;
  if (!mark) return { state: "none" };
  if (mark.failed) return { state: "rebuild-failed", at: mark.at, failures: mark.failed.count, reason: mark.failed.reason };
  return { state: "noted", at: mark.at };
}

/** Whether a damaged full-text index was noted: the next open tries to make it anew. */
export async function fullTextDamageNoted(db: SqlStatements): Promise<boolean> {
  return (await readFullTextDamage(db)).state !== "none";
}

/**
 * Notes a damaged full-text index; a note already there stays as it is (with
 * what it says about a failed attempt). Never inside a transaction's body.
 */
export async function noteFullTextDamage(db: SqlStatements): Promise<void> {
  await db.execute(`INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)`, [FULL_TEXT_DAMAGED_MARK, JSON.stringify({ at: new Date().toISOString() })]);
}

/**
 * Records that making the noted full-text index anew failed at an open. The
 * note stays: the next open tries again. Returns how many attempts failed. The
 * reason is SQLite's words, cut short — never a note's text or path.
 */
export async function noteFullTextRebuildFailed(db: SqlStatements, error: unknown): Promise<number> {
  const row = await db.queryOne<{ key: string; value: string }>(`SELECT key, value FROM meta WHERE key = ?`, [FULL_TEXT_DAMAGED_MARK]).catch(() => null);
  const mark = (row && row.key === FULL_TEXT_DAMAGED_MARK ? markValue(row.value) : null) ?? { at: new Date().toISOString() };
  const count = (mark.failed?.count ?? 0) + 1;
  const reason = (error instanceof Error ? error.message : String(error)).replace(/^error returned from database:\s*/i, "").slice(0, 160);
  const next: MarkValue = { at: mark.at, failed: { at: new Date().toISOString(), count, reason } };
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [FULL_TEXT_DAMAGED_MARK, JSON.stringify(next)]);
  return count;
}

const WATCHED = new Set(["execute", "query", "queryOne", "runBatch", "transaction"]);

/** What a failed statement says about the full-text index: damaged, or perhaps (a damaged page met while reaching it). */
export type FullTextDamageReading = "damaged" | "perhaps";
type Reading = FullTextDamageReading | null;

/**
 * Notes what a failed statement says, where it is so: `perhaps` only when
 * FTS5's own check finds the full-text index damaged. Whether it was noted.
 * The window that owns the database answers this for one that only reads it
 * (the desktop's auxiliary windows, `watchFullTextDamage`'s `record`).
 */
export async function noteFullTextDamageFound(db: SqlStatements, reading: FullTextDamageReading): Promise<boolean> {
  if (reading === "perhaps" && (await fullTextIsDamaged(db)) !== true) return false;
  await noteFullTextDamage(db);
  return true;
}
function readingOf(error: unknown, sql: string): Reading {
  if (isDamagedFullText(error)) return "damaged";
  if (isDamagedPage(error) && NAMES_FULL_TEXT.test(sql)) return "perhaps";
  return null;
}
const sqlOf = (args: unknown[]): string =>
  Array.isArray(args[0]) ? (args[0] as { sql?: unknown }[]).map((s) => String(s?.sql ?? "")).join("\n") : String(args[0] ?? "");

/**
 * The database as the shell hands it on, noting a damaged full-text index
 * wherever a statement meets it: on the adapter itself, in a batch, and in a
 * transaction's body — there after the transaction is through, rolled back or
 * not, since a write to the adapter while it is open would wait for it. A
 * damaged page met while reaching the full-text index is noted only when
 * FTS5's own check finds the full-text index damaged. The error itself goes
 * on unchanged. `onNoted` hears of it once. `record` notes it somewhere else:
 * a window that only reads the database hands it to the one that owns it.
 */
export function watchFullTextDamage<T extends IDatabaseAdapter>(
  db: T,
  onNoted?: (error: unknown) => void,
  record: (reading: FullTextDamageReading) => Promise<boolean> = (reading) => noteFullTextDamageFound(db, reading),
): T {
  let noted = false;
  const note = async (error: unknown, reading: Reading) => {
    if (noted || !reading) return;
    noted = true;
    try {
      if (!(await record(reading))) {
        noted = false;
        return;
      }
    } catch (failure) {
      // Not noted: the next statement that meets the damage tries again.
      noted = false;
      console.error("[index] noting the damaged full-text index failed", failure);
      return;
    }
    console.error("[index] the full-text index is damaged; it is made anew at the next open", error);
    onNoted?.(error);
  };
  const watched = <R>(sql: string, run: () => Promise<R>): Promise<R> =>
    run().catch(async (error: unknown) => {
      await note(error, readingOf(error, sql));
      throw error;
    });
  const handle = (tx: SqlStatements, met: { error: unknown; reading: Reading }): SqlStatements => {
    const seen = <R>(sql: string, run: () => Promise<R>): Promise<R> =>
      run().catch((error: unknown) => {
        const reading = readingOf(error, sql);
        if (reading && met.reading !== "damaged") {
          met.error = error;
          met.reading = reading;
        }
        throw error;
      });
    return {
      execute: (sql, params) => seen(sql, () => tx.execute(sql, params)),
      query: (sql, params) => seen(sql, () => tx.query(sql, params)),
      queryOne: (sql, params) => seen(sql, () => tx.queryOne(sql, params)),
      ...(tx.runBatch ? { runBatch: (statements) => seen(sqlOf([statements]), () => tx.runBatch!(statements)) } : {}),
    };
  };
  // Its own name: the transaction guard reads bodies by the name of what opens one.
  const transactionWatchingFullText = async <R>(fn: (tx: SqlStatements) => Promise<R>): Promise<R> => {
    const met: { error: unknown; reading: Reading } = { error: undefined, reading: null };
    try {
      return await db.transaction((tx) => fn(handle(tx, met)));
    } catch (error) {
      if (!met.reading && isDamagedFullText(error)) {
        met.error = error;
        met.reading = "damaged";
      }
      throw error;
    } finally {
      if (met.reading) await note(met.error, met.reading);
    }
  };
  return new Proxy(db, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || !WATCHED.has(key) || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (key === "transaction") return transactionWatchingFullText;
      return (...args: unknown[]) => watched(sqlOf(args), () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  });
}
