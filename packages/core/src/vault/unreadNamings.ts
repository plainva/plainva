import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { FULL_TEXT_ROW_IS_FILED } from "../db/fullTextRows.js";
import { SMALLEST_UNREAD_CHARS } from "../inlineParseBudget.js";
import { ftsExactTerm } from "./ftsQuery.js";

/**
 * The notes that may name a note in a part the parse budget leaves unread
 * (`ReadAsTextParts.unread`): such a part gives the index no link, so a rename
 * that plans from the backlinks never opens the note, and a link that stands
 * only there was left behind without a word (review of L14, 2026-11-26).
 *
 * The full-text index holds every note's text as it is, so the notes whose
 * text holds one of `names` are found with one query a name — the search's
 * own phrase (`ftsExactTerm`, as the scan for unlinked mentions asks) — and of
 * them only those large enough to hold a part not read at all
 * (`SMALLEST_UNREAD_CHARS`; the file's size in bytes is never less than its
 * characters). The caller reads each of them and counts what its unread parts
 * name (`unreadNaming`); nothing in them is rewritten. No new index format: the
 * cost is a query a name and the reading of the large notes that hold it.
 */
export async function notesThatMayNameUnread(db: IDatabaseAdapter, names: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const name of new Set(names)) {
    const expression = name.trim() ? ftsExactTerm(name) : null;
    if (!expression) continue;
    const rows = await db.query<{ path: string }>(
      `SELECT fts_notes.path AS path FROM fts_notes JOIN files f ON f.path = fts_notes.path
       WHERE fts_notes MATCH ? AND ${FULL_TEXT_ROW_IS_FILED} AND (f.is_deleted IS NULL OR f.is_deleted = 0) AND (f.size_bytes IS NULL OR f.size_bytes >= ?)`,
      [expression, SMALLEST_UNREAD_CHARS]
    );
    for (const row of rows) if (row.path) found.add(String(row.path));
  }
  return [...found];
}
