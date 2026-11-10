/**
 * How a note's row in the full-text table is found (index format 9,
 * Gesamtplan Leistung L1).
 *
 * `fts_notes.path` is UNINDEXED: FTS5 keeps no index on it, so a statement
 * that names a row by its path reads every row of the table, and the text it
 * holds with it. Measured at 10 000 notes: 7.17 ms for one such delete, which
 * every save and every note of a first index run paid, against 0.011 ms by
 * the row number — 64 of the 96 seconds of a cold index.
 *
 * Since format 9 a note's full-text row carries the NEGATED row number of its
 * row in `files`: `fts_notes.rowid = -files.rowid`. Every write reaches the
 * row through that number. Negative, because an app older than format 9 still
 * writes rows of its own on such an index (after a downgrade) and leaves the
 * number to SQLite, which counts on from the largest one — always 0 or above.
 * The two kinds of row can never meet, and a row at 0 or above says that an
 * older app wrote it: `keyFullTextRowsByFile` in Schema.ts gives it its number
 * at the next start.
 *
 * A row in `files` gets a new number whenever the indexer reads its file again
 * (it is deleted and inserted), so the full-text row is deleted BEFORE the
 * file's row and inserted AFTER it. A move keeps the number
 * (`UPDATE files SET path`), and so does the full-text row.
 *
 * Reads still name rows by path where they did; the statements of this file
 * are the writes.
 */

/** Deletes the full-text rows of the `files` rows that `where` selects — run before those rows are deleted. */
export const deleteFullTextRowsOfFiles = (where: string): string =>
  `DELETE FROM fts_notes WHERE rowid IN (SELECT -rowid FROM files WHERE ${where})`;

/**
 * Writes the full-text row of the note whose `files` row sits at the path —
 * run after that row is inserted. Parameters: content, title, path,
 * seg_content, seg_title, and the path once more (the row number is looked
 * up last, so the first five keep the order every earlier version used).
 * `OR REPLACE`: a row left at that number by anything that did not keep to
 * these rules gives way instead of failing the whole batch.
 */
export const INSERT_FULL_TEXT_ROW =
  `INSERT OR REPLACE INTO fts_notes (content, title, path, seg_content, seg_title, rowid)
   VALUES (?, ?, ?, ?, ?, -(SELECT rowid FROM files WHERE path = ?))`;

/**
 * Below every row number SQLite hands out or format 9 writes (`-files.rowid`):
 * where a migration pages through `fts_notes` by `rowid > ?`, it starts here.
 */
export const FIRST_ROWID_BEFORE = -Number.MAX_SAFE_INTEGER;
