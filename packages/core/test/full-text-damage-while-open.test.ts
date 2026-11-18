import { afterEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { FULL_TEXT_NUMBERING_DIAGNOSTIC, initializeSchema } from "../src/db/Schema.js";
import { FULL_TEXT_DAMAGED_MARK, fullTextDamageNoted, watchFullTextDamage } from "../src/db/fullTextDamage.js";

/**
 * A damaged full-text index met while the vault is open (SQLITE_CORRUPT_VTAB,
 * 267). With the table's root pages whole the open passes; the damage shows
 * at a search, at a read of a note's text and at a write — the indexer's, and
 * the trigger that takes a removed note's row. Without the watch nothing
 * noted it: the search said "failed, try again" on every try, and no open
 * ever made the table anew. Now whatever meets it notes it, and the next open
 * makes only the full-text table anew: the sync state, the queue and the rows
 * stay, and every note goes to the next full pass.
 */

const DAMAGED = 'error returned from database: (code: 267) fts5: corruption found reading blob 549755813889 from table "fts_notes"';

/**
 * The database with a full-text table whose pages are damaged until it is
 * dropped: every statement that reaches it fails as SQLite's does — also a
 * delete of a note's files row, whose trigger removes its full-text row.
 */
function withDamagedFullText(db: IDatabaseAdapter) {
  const state = { damaged: true };
  const guard = (sql: string) => {
    if (!state.damaged) return;
    if (/DROP TABLE (IF EXISTS )?fts_notes\b/i.test(sql)) {
      state.damaged = false;
      return;
    }
    if ((/\bfts_notes\b/.test(sql) && !/^\s*CREATE\b/i.test(sql)) || /^\s*DELETE FROM files\b/i.test(sql)) throw new Error(DAMAGED);
  };
  const handle = (on: SqlStatements): SqlStatements => ({
    execute: async (sql, params) => { guard(sql); return on.execute(sql, params); },
    query: async (sql, params) => { guard(sql); return on.query(sql, params); },
    queryOne: async (sql, params) => { guard(sql); return on.queryOne(sql, params); },
    ...(on.runBatch ? { runBatch: async (statements) => { for (const st of statements) guard(st.sql); return on.runBatch!(statements); } } : {}),
  });
  const wrapped: IDatabaseAdapter = { ...db, ...handle(db), transaction: (fn) => db.transaction((tx) => fn(handle(tx))) };
  return { db: wrapped, state };
}

async function vaultWithANote() {
  const raw = await realSqlite();
  await raw.execute(`INSERT INTO files (id, path, sha256, mtime_local, size_bytes) VALUES ('a', 'Note.md', 'h', 1000, 5)`);
  await raw.execute(`INSERT INTO sync_state (path, base_sha256, remote_etag) VALUES ('Note.md', 'h', 'e1')`);
  await raw.execute(`INSERT INTO offline_queue (file_path, operation) VALUES ('Note.md', 'push')`);
  return raw;
}

afterEach(() => vi.restoreAllMocks());

describe("a damaged full-text index met while the vault is open", () => {
  it("a search notes it, the error goes on as it was, and the next open makes the full-text table anew — nothing else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = await vaultWithANote();
    const syncBefore = await raw.query(`SELECT * FROM sync_state`);
    const queueBefore = await raw.query(`SELECT * FROM offline_queue`);
    const { db, state } = withDamagedFullText(raw);
    const heard: unknown[] = [];
    const watched = watchFullTextDamage(db, (error) => heard.push(error));

    await expect(watched.query(`SELECT path FROM fts_notes WHERE fts_notes MATCH ?`, ["hello"])).rejects.toThrow(DAMAGED);
    expect(await fullTextDamageNoted(raw), "noted in the database").toBe(true);
    expect(heard).toHaveLength(1);
    // Met again: noted once.
    await expect(watched.queryOne(`SELECT content FROM fts_notes WHERE rowid = 1`)).rejects.toThrow(DAMAGED);
    expect(heard).toHaveLength(1);

    // The next open.
    await initializeSchema(db);
    expect(state.damaged, "the full-text table was made anew").toBe(false);
    expect(await fullTextDamageNoted(raw), "the note is gone with it").toBe(false);
    expect(await raw.query(`SELECT * FROM sync_state`)).toEqual(syncBefore);
    expect(await raw.query(`SELECT * FROM offline_queue`)).toEqual(queueBefore);
    const file = await raw.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = 'Note.md'`);
    expect(file?.mtime_local, "read again by the next full pass").toBe(0);
    await raw.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('hello world', 'Note', 'Note.md')`);
    expect(await raw.query(`SELECT path FROM fts_notes WHERE fts_notes MATCH 'hello'`)).toEqual([{ path: "Note.md" }]);
  });

  it("a write in a transaction notes it once the transaction is through: nothing of the body is kept, and the note does not wait for the body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = await vaultWithANote();
    const { db } = withDamagedFullText(raw);
    const watched = watchFullTextDamage(db);

    await expect(
      watched.transaction(async (tx) => {
        await tx.execute(`UPDATE files SET title = 'Changed' WHERE path = 'Note.md'`);
        await tx.execute(`DELETE FROM files WHERE path = 'Note.md'`);
      }),
    ).rejects.toThrow(DAMAGED);
    expect(await fullTextDamageNoted(raw)).toBe(true);
    expect((await raw.queryOne<{ title: string | null }>(`SELECT title FROM files WHERE path = 'Note.md'`))?.title, "rolled back").not.toBe("Changed");
  });

  it("a body that catches the damage and goes on still has it noted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = await vaultWithANote();
    const { db } = withDamagedFullText(raw);
    const watched = watchFullTextDamage(db);

    await watched.transaction(async (tx) => {
      await tx.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('x', 'Note', 'Note.md')`).catch(() => undefined);
      await tx.execute(`UPDATE files SET title = 'Kept' WHERE path = 'Note.md'`);
    });
    expect(await fullTextDamageNoted(raw)).toBe(true);
    expect((await raw.queryOne<{ title: string }>(`SELECT title FROM files WHERE path = 'Note.md'`))?.title).toBe("Kept");
  });

  it("other failures are not noted, and a whole database opens as it did", async () => {
    const raw = await vaultWithANote();
    const watched = watchFullTextDamage(raw);
    await expect(watched.query(`SELECT nothing FROM nowhere`)).rejects.toThrow();
    expect(await fullTextDamageNoted(raw)).toBe(false);
    await initializeSchema(watched);
    expect(await raw.queryOne(`SELECT value FROM meta WHERE key = ?`, [FULL_TEXT_NUMBERING_DIAGNOSTIC]), "no note: the full-text table was not made anew").toBeNull();
    expect(await raw.queryOne(`SELECT value FROM meta WHERE key = ?`, [FULL_TEXT_DAMAGED_MARK])).toBeNull();
  });
});
