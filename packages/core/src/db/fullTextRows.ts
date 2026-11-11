/**
 * How a note's row in the full-text table is found (index format 9,
 * Gesamtplan Leistung L1).
 *
 * `fts_notes.path` is UNINDEXED: FTS5 keeps no index on it, so a statement
 * that names a row by its path reads every row of the table, and the text it
 * holds with it. Measured at 10 000 notes: 7.17 ms for one such delete, which
 * every save and every note of a first index run paid, against 0.011 ms by
 * the row number.
 *
 * Since format 9 the `files` row of a note names its full-text row
 * (`files.fts_rowid`, read through {@link fullTextRowOf}):
 *
 * - `0` — the full-text row is numbered `-files.rowid`. Every row this build
 *   writes is numbered so: the number is known before the insert, so it needs
 *   no second statement and no read of an insert id (a pooled connection on
 *   the desktop would not give the right one). Negative, so it never meets a
 *   number SQLite handed out on its own (an index from before format 9 keeps
 *   those, from 1 up).
 * - another number — the row an index from before format 9 had for the file:
 *   the conversion records it instead of rewriting the row, which would read
 *   every note's text again through the tokenizer.
 * - `NULL` — written by a build that does not know the column: an app before
 *   format 9 on this index after a downgrade. The trigger
 *   `files_written_by_older_index` raises the flag {@link UNNUMBERED_FLAG} on
 *   such an insert, and the next start numbers what that build left behind
 *   (`numberFullTextRows` in Schema.ts).
 *
 * A deleted `files` row takes its full-text row with it, through the trigger
 * `files_takes_its_full_text_row` — for this build and for an older one
 * alike, so no row can outlive its file. (A `REPLACE` deletes without firing
 * delete triggers; this build never replaces a `files` row, an older one
 * raises the flag when it does.)
 *
 * Readers join `files` by path and by this number: a row whose number and
 * path do not both belong to one file is never shown, whatever state an
 * older build left.
 */

/** The full-text row number of the `files` row `alias` names, as SQL. */
export const fullTextRowOf = (alias: string): string =>
  `(CASE ${alias}.fts_rowid WHEN 0 THEN -${alias}.rowid ELSE ${alias}.fts_rowid END)`;

/** The `meta` key an insert by an older build sets (Schema.ts creates the trigger). */
export const UNNUMBERED_FLAG = "fts_rows_unnumbered";

/**
 * Writes the full-text row of the note whose `files` row sits at the path —
 * run after that row is inserted, in the same batch (its number is looked up
 * when the statement runs). Parameters: content, title, path, seg_content,
 * seg_title, and the path once more (the first five keep the order every
 * earlier version used). `OR REPLACE`: a row left at that number by anything
 * that did not keep to these rules gives way instead of failing the batch.
 */
export const INSERT_FULL_TEXT_ROW =
  `INSERT OR REPLACE INTO fts_notes (content, title, path, seg_content, seg_title, rowid)
   VALUES (?, ?, ?, ?, ?, -(SELECT rowid FROM files WHERE path = ?))`;

/**
 * The `files` row and its full-text row, joined the one way that is always
 * right: same path, and the number the `files` row names. `f` and `n` are the
 * aliases.
 */
export const FILE_AND_FULL_TEXT_ROW = `files f JOIN fts_notes n ON n.rowid = ${fullTextRowOf("f")} AND n.path = f.path`;

/**
 * Below every row number SQLite hands out or format 9 writes (`-files.rowid`):
 * where a migration pages through `fts_notes` by `rowid > ?`, it starts here.
 */
export const FIRST_ROWID_BEFORE = -Number.MAX_SAFE_INTEGER;

/**
 * A condition on `fts_notes` (unaliased): the row belongs to a file — one
 * that has its path and names its number. Readers that list from the table
 * keep only such rows, so nothing an older build left can show up twice, or
 * for a note that is gone.
 */
export const FULL_TEXT_ROW_IS_FILED = `EXISTS (SELECT 1 FROM files f WHERE f.path = fts_notes.path AND ${fullTextRowOf("f")} = fts_notes.rowid)`;
