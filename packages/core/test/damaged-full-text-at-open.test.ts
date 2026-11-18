import { afterEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema, isDamagedFullText } from "../src/db/Schema.js";

/**
 * A damaged full-text index at the open (SQLITE_CORRUPT_VTAB, 267): the FTS5
 * table's own pages are bad, the rest of the database is not. The open makes
 * the full-text table anew instead of failing — the sync state, the queue and
 * the rows stay, and every note goes to the next full pass. Without this the
 * start offered to set the WHOLE database aside, and with it the sync state.
 */

const DAMAGED = 'error returned from database: (code: 267) fts5: corruption found reading blob 549755813889 from table "fts_notes"';

/** The database, with a full-text table whose pages are damaged until it is dropped: every statement reading it fails as SQLite's does. */
function withDamagedFullText(db: IDatabaseAdapter) {
  const state = { damaged: true, failures: 0 };
  const guard = (sql: string) => {
    if (!state.damaged) return;
    if (/DROP TABLE (IF EXISTS )?fts_notes\b/i.test(sql)) {
      state.damaged = false;
      return;
    }
    if (/\bfts_notes\b/.test(sql) && !/^\s*CREATE\b/i.test(sql)) {
      state.failures += 1;
      throw new Error(DAMAGED);
    }
  };
  const handle = (on: SqlStatements): SqlStatements => ({
    ...on,
    execute: async (sql, params) => { guard(sql); return on.execute(sql, params); },
    query: async (sql, params) => { guard(sql); return on.query(sql, params); },
    queryOne: async (sql, params) => { guard(sql); return on.queryOne(sql, params); },
    ...(on.runBatch ? { runBatch: async (statements) => { for (const st of statements) guard(st.sql); return on.runBatch!(statements); } } : {}),
  });
  const wrapped: IDatabaseAdapter = {
    ...db,
    ...handle(db),
    transaction: (fn) => db.transaction((tx) => fn(handle(tx))),
  };
  return { db: wrapped, state };
}

afterEach(() => vi.restoreAllMocks());

describe("a damaged full-text index at the open", () => {
  it("is made anew; the sync state, the queue and the rows stay, and the notes go to the next full pass", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = await realSqlite();
    await raw.execute(`INSERT INTO files (id, path, sha256, mtime_local, size_bytes) VALUES ('a', 'Note.md', 'h', 1000, 5)`);
    await raw.execute(`INSERT INTO sync_state (path, base_sha256, remote_etag) VALUES ('Note.md', 'h', 'e1')`);
    const syncBefore = await raw.query(`SELECT * FROM sync_state`);
    await raw.execute(`INSERT INTO offline_queue (file_path, operation) VALUES ('Note.md', 'push')`);
    const queueBefore = await raw.query(`SELECT * FROM offline_queue`);
    expect(queueBefore).toHaveLength(1);
    const { db, state } = withDamagedFullText(raw);

    // The open again: without the repair it fails the way the driver says it.
    await expect(initializeSchema(db)).resolves.toBeUndefined();
    expect(state.failures, "the damage was met on the way").toBeGreaterThan(0);
    expect(state.damaged, "the full-text table was made anew").toBe(false);

    expect(await raw.query(`SELECT * FROM sync_state`)).toEqual(syncBefore);
    expect(await raw.query(`SELECT * FROM offline_queue`)).toEqual(queueBefore);
    const file = await raw.queryOne<{ mtime_local: number; fts_rowid: number }>(`SELECT mtime_local, fts_rowid FROM files WHERE path = 'Note.md'`);
    expect(file?.mtime_local, "read again by the next full pass").toBe(0);

    // Search works again once a note is written into it.
    await raw.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('hello world', 'Note', 'Note.md')`);
    expect(await raw.query(`SELECT path FROM fts_notes WHERE fts_notes MATCH 'hello'`)).toEqual([{ path: "Note.md" }]);
  });

  it("damage anywhere else still fails the open", async () => {
    const raw = await realSqlite();
    const db: IDatabaseAdapter = {
      ...raw,
      execute: async (sql, params) => {
        if (/CREATE TABLE IF NOT EXISTS files\b/.test(sql)) throw new Error("error returned from database: (code: 11) database disk image is malformed");
        return raw.execute(sql, params);
      },
    };
    await expect(initializeSchema(db)).rejects.toThrow("database disk image is malformed");
  });

  it("knows SQLITE_CORRUPT_VTAB in each driver's words, and nothing else for it", () => {
    expect(isDamagedFullText(new Error(DAMAGED))).toBe(true);
    expect(isDamagedFullText(new Error("SQLITE_CORRUPT_VTAB: database disk image is malformed"))).toBe(true);
    expect(isDamagedFullText(new Error('fts5: corruption found reading blob 1 from table "fts_notes"'))).toBe(true);
    expect(isDamagedFullText(new Error("error returned from database: (code: 11) database disk image is malformed"))).toBe(false);
    expect(isDamagedFullText(new Error("error returned from database: (code: 2675) other"))).toBe(false);
  });
});
