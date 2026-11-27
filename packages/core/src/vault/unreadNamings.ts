import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { SMALLEST_UNREAD_CHARS } from "../inlineParseBudget.js";

/**
 * The notes that may name a note in a part that is not read for links
 * (`NoteLinks.unread`: what the parse budget leaves unread, and where a
 * definition a part does not see may change its brackets): such a part gives
 * the index no link, so a rename that plans from the backlinks never opens the
 * note, and a link that stands only there was left behind without a word
 * (review of L14, 2026-11-26).
 *
 * Every note large enough to hold such a part (`SMALLEST_UNREAD_CHARS`; the
 * file's size in bytes is never less than its characters). No search narrows
 * it: a link may write its target in ways no phrase of the name finds —
 * escaped (`Note%20\(1\).md`), with an entity, partly encoded even in ASCII
 * (`%4eame`) — and what decides is the rename's resolver (review of L14, round
 * four). The caller reads each, and only a note over its budget is read for
 * what its parts name (`unreadLinksTo`); nothing in them is rewritten.
 */
export async function notesThatMayNameUnread(db: IDatabaseAdapter): Promise<string[]> {
  const rows = await db.query<{ path: string }>(
    `SELECT f.path AS path FROM files f WHERE (f.is_deleted IS NULL OR f.is_deleted = 0) AND (f.size_bytes IS NULL OR f.size_bytes >= ?) AND lower(f.path) LIKE '%.md'`,
    [SMALLEST_UNREAD_CHARS]
  );
  return rows.map((row) => String(row.path)).filter((path) => path !== "");
}
