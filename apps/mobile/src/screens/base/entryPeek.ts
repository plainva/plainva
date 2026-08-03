/**
 * An entry as its database sees it (S20).
 *
 * The desktop has two ways to look at a row without leaving the table: the
 * floating peek and the sidebar's entry inspector. The phone had neither —
 * tapping a row left the database entirely, and coming back meant scrolling to
 * the same place again. That is the expensive part on a phone, not the reading.
 *
 * This derives the inspector from the rows the view has ALREADY loaded, so
 * opening it costs no query and cannot disagree with what is on screen: the
 * position is the position in this view, and the neighbours are the rows above
 * and below — the same reading `noteDatabaseContext` uses for the desktop.
 */

export type PeekRow = Record<string, unknown>;

export interface EntryPeek {
  path: string;
  title: string;
  /** 1-based position in the view, and the view's length ("12 / 34"). */
  index: number;
  total: number;
  /** Neighbours in view order; null at either end. */
  prevPath: string | null;
  nextPath: string | null;
  /** Visible columns of the view, in the order the table shows them. */
  columns: string[];
  row: PeekRow;
}

const pathOf = (r: PeekRow) => String(r["file.path"] ?? "");
const titleOf = (r: PeekRow) => String(r["file.name"] ?? "");

/**
 * Returns null when the path is not part of this view — the caller then has
 * nothing honest to show. That happens legitimately: a row can be deleted or
 * filtered out while its sheet is open.
 */
export function buildEntryPeek(rows: readonly PeekRow[], columns: readonly string[], path: string): EntryPeek | null {
  const i = rows.findIndex((r) => pathOf(r) === path);
  if (i < 0) return null;
  const row = rows[i];
  return {
    path,
    title: titleOf(row) || path,
    index: i + 1,
    total: rows.length,
    prevPath: i > 0 ? pathOf(rows[i - 1]) || null : null,
    nextPath: pathOf(rows[i + 1] ?? {}) || null,
    columns: [...columns],
    row,
  };
}
