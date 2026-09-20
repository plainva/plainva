/**
 * A list that stays on screen while it reloads (finding 2026-09-20, plan A6).
 *
 * Both task views set `loading` on EVERY index change and drew nothing while it
 * was set. Normally that is a blink nobody sees; while a sync moved some 900
 * files the index changed every second, and the "From notes" box flickered for
 * minutes. A list that reloads is still a list: the old rows are the best thing
 * to show until the new ones arrive.
 *
 * So the rows remember WHERE THEY CAME FROM (the vault's query service). Only a
 * different source blanks the view — another vault's tasks must never stand in
 * for this one's, not even for a frame — and a reload that fails keeps what is
 * there instead of replacing a full list with an empty one.
 *
 * Pure on purpose: both shells hold this in one `useState` and the rules are
 * testable without React.
 */
export interface KeptList<T, S> {
  rows: T[];
  /** What the rows were loaded from; null before the first load. */
  source: S | null;
}

export function emptyKeptList<T, S>(): KeptList<T, S> {
  return { rows: [], source: null };
}

/** A load finished: these are the rows of `source` now. */
export function keptListLoaded<T, S>(rows: T[], source: S): KeptList<T, S> {
  return { rows, source };
}

/** A load failed: keep the rows of the SAME source, never those of another. */
export function keptListFailed<T, S>(prev: KeptList<T, S>, source: S): KeptList<T, S> {
  return prev.source === source ? prev : { rows: [], source };
}

/** An optimistic change to the rows on screen (a checkbox just ticked). */
export function keptListMap<T, S>(prev: KeptList<T, S>, change: (rows: T[]) => T[]): KeptList<T, S> {
  return { ...prev, rows: change(prev.rows) };
}

/** The rows to draw for `source` — never another source's. */
export function keptListRows<T, S>(list: KeptList<T, S>, source: S | null): T[] {
  return source !== null && list.source === source ? list.rows : [];
}

/** True only until the FIRST load of `source` has settled. */
export function keptListLoading<T, S>(list: KeptList<T, S>, source: S | null): boolean {
  return source !== null && list.source !== source;
}
