import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { FULL_TEXT_ROW_IS_FILED, fullTextRowOf } from "../db/fullTextRows.js";
import { SMALLEST_UNREAD_CHARS } from "../inlineParseBudget.js";
import { ftsExactTerm } from "./ftsQuery.js";

/**
 * The notes that may name a note in a part that is not read for links
 * (`NoteLinks.unread`: what the parse budget leaves unread, and where a
 * definition a part does not see may change its brackets): such a part gives
 * the index no link, so a rename that plans from the backlinks never opens the
 * note, and a link that stands only there was left behind without a word
 * (review of L14, 2026-11-26).
 *
 * The full-text index holds every note's text as it is, so the notes whose
 * text holds one of `names` are found with one query a name — the search's
 * own phrase (`ftsExactTerm`, as the scan for unlinked mentions asks) — and of
 * them only those large enough to hold such a part (`SMALLEST_UNREAD_CHARS`;
 * the file's size in bytes is never less than its characters). Where the
 * search cannot find a name for sure, every note that large is read: a name
 * without a letter or a digit gives the search nothing to look for (`🚀`), a
 * name beyond ASCII may stand in a link partly encoded (`Gr%C3%B6ße`),
 * and a note without its row in the full-text index (not indexed yet, or its
 * indexing failed) is not found by any phrase. The caller reads each of them
 * and counts what such parts name (`unreadNaming`); nothing in them is
 * rewritten. No new index format: the cost is a query a name and the reading
 * of the large notes that hold it.
 */
export async function notesThatMayNameUnread(db: IDatabaseAdapter, names: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  const large = `(f.is_deleted IS NULL OR f.is_deleted = 0) AND (f.size_bytes IS NULL OR f.size_bytes >= ?)`;
  const add = (rows: { path: string }[]) => {
    for (const row of rows) if (row.path) found.add(String(row.path));
  };
  const wanted = [...new Set(names)].filter((name) => name.trim() !== "");
  // A name without a letter or a digit gives the search no word; one beyond ASCII may stand partly encoded
  // (`Gr%C3%B6ße`), which no phrase of it matches.
  if (wanted.some((name) => !/[\p{L}\p{N}]/u.test(name) || /[^\p{ASCII}]/u.test(name))) {
    add(await db.query<{ path: string }>(`SELECT f.path AS path FROM files f WHERE ${large}`, [SMALLEST_UNREAD_CHARS]));
    return [...found];
  }
  for (const name of wanted) {
    const expression = ftsExactTerm(name);
    if (!expression) continue;
    add(
      await db.query<{ path: string }>(
        `SELECT fts_notes.path AS path FROM fts_notes JOIN files f ON f.path = fts_notes.path
         WHERE fts_notes MATCH ? AND ${FULL_TEXT_ROW_IS_FILED} AND ${large}`,
        [expression, SMALLEST_UNREAD_CHARS]
      )
    );
  }
  // A note the full-text index holds no row of is found by no phrase.
  add(
    await db.query<{ path: string }>(
      `SELECT f.path AS path FROM files f WHERE ${large} AND lower(f.path) LIKE '%.md'
       AND NOT EXISTS (SELECT 1 FROM fts_notes WHERE fts_notes.rowid = ${fullTextRowOf("f")} AND fts_notes.path = f.path)`,
      [SMALLEST_UNREAD_CHARS]
    )
  );
  return [...found];
}
