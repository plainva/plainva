import { addDays, dayPartOf, entryDayKeys } from "./calendarRange";

/**
 * The timeline of a `.base` as a row per entry (S21, plan P10).
 *
 * Until now the timeline was a column per day, and a multi-day entry appeared
 * as a start card followed by look-alike continuation chips — the same "chain"
 * the calendar stopped in S5 and S20. A bar needs a row: one line per entry,
 * one bar from start to end, and two edges you can take hold of.
 *
 * Everything here is pure, and shared because the phone shows the same rows
 * (S21b, where the edge becomes a touch gesture). What differs between the
 * surfaces is how one grabs an edge, never what grabbing it MEANS.
 */

export type TimelineScale = "week" | "threeWeeks" | "quarter";

/** How many days each scale shows. Wider scales trade detail for reach. */
export const TIMELINE_DAYS: Record<TimelineScale, number> = {
  week: 7,
  threeWeeks: 21,
  quarter: 91,
};

export interface TimelineWindow {
  scale: TimelineScale;
  /** First day shown, YYYY-MM-DD. */
  from: string;
}

/** The day keys the window covers, in display order. */
export function windowDays(win: TimelineWindow): string[] {
  return Array.from({ length: TIMELINE_DAYS[win.scale] }, (_, i) => addDays(win.from, i));
}

/** Moves the window by one screenful, forwards or back. */
export function stepWindow(win: TimelineWindow, delta: -1 | 1): TimelineWindow {
  return { ...win, from: addDays(win.from, delta * TIMELINE_DAYS[win.scale]) };
}

/**
 * A window that puts `day` in view with some past context — a timeline that
 * starts exactly on today hides everything that led up to it.
 */
export function windowAround(day: string, scale: TimelineScale): TimelineWindow {
  return { scale, from: addDays(day, -Math.floor(TIMELINE_DAYS[scale] / 3)) };
}

export interface TimelineBar {
  /** Zero-based column of the first day shown; the bar may start earlier. */
  startCol: number;
  /** Zero-based column of the last day shown, inclusive. */
  endCol: number;
  /** The entry begins before the window — no left handle, flat edge. */
  clippedStart: boolean;
  /** The entry ends after the window — no right handle, flat edge. */
  clippedEnd: boolean;
}

/**
 * Where an entry's bar sits in the window, or null when it lies outside it
 * entirely.
 *
 * An entry with no end (or an end before its start) is a bar of ONE day rather
 * than nothing: on a timeline a single date is still a point in time one wants
 * to see and to drag.
 */
export function barFor(start: unknown, end: unknown, days: readonly string[]): TimelineBar | null {
  const keys = entryDayKeys(start, end);
  if (keys.length === 0 || days.length === 0) return null;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const winFrom = days[0]!;
  const winTo = days[days.length - 1]!;
  if (last < winFrom || first > winTo) return null;
  const startCol = first < winFrom ? 0 : days.indexOf(first);
  const endCol = last > winTo ? days.length - 1 : days.indexOf(last);
  if (startCol < 0 || endCol < 0) return null;
  return { startCol, endCol, clippedStart: first < winFrom, clippedEnd: last > winTo };
}

/**
 * Is this entry a milestone?
 *
 * A milestone is a DERIVATION, not a stored flag (decision E4): an entry with a
 * date and no end is a moment, not a span — a release date, a deadline, a
 * hand-over. Deriving it means nobody has to maintain a checkbox that can
 * disagree with the dates next to it, and it works in every database that
 * already has a date column.
 */
export function isMilestone(start: unknown, end: unknown): boolean {
  const keys = entryDayKeys(start, end);
  if (keys.length !== 1) return false;
  // An end that equals the start is still a one-day SPAN the user typed —
  // only the absence of an end makes it a moment.
  return !dayPartOf(end);
}

export interface EdgeDragResult {
  /** The day to write into the start column, when it changed. */
  start?: string;
  /** The day to write into the end column, when it changed. */
  end?: string;
}

/**
 * What dragging an edge to `toDay` means.
 *
 * The two rules that keep a drag from producing nonsense:
 *
 *  - An edge never crosses the other one. Dragging the end before the start
 *    clamps it to the start (a one-day entry), rather than writing an end that
 *    lies before its beginning.
 *  - Dragging the START of an entry that has no end column keeps it a single
 *    date — an end must never be invented by a gesture that was about the
 *    beginning.
 *
 * `hasEnd` says whether the view HAS an end column to write into; without one
 * only the start can move.
 */
export function edgeDrag(opts: {
  edge: "start" | "end";
  toDay: string;
  currentStart: unknown;
  currentEnd: unknown;
  hasEnd: boolean;
}): EdgeDragResult {
  const start = dayPartOf(opts.currentStart);
  if (!start) return {};
  const end = dayPartOf(opts.currentEnd);
  const to = dayPartOf(opts.toDay);
  if (!to) return {};

  if (opts.edge === "start") {
    // Moving the start past the end would invert the bar; clamp instead.
    const clamped = end && to > end ? end : to;
    return clamped === start ? {} : { start: clamped };
  }
  if (!opts.hasEnd) return {};
  const clamped = to < start ? start : to;
  return clamped === (end || start) ? {} : { end: clamped };
}

/**
 * Moving the WHOLE bar: the start goes to `toDay`, the end follows by the same
 * number of days. Dragging a three-day task and having it become a one-day task
 * would be a data change nobody asked for.
 */
export function moveBar(opts: { toDay: string; currentStart: unknown; currentEnd: unknown; hasEnd: boolean }): EdgeDragResult {
  const start = dayPartOf(opts.currentStart);
  const to = dayPartOf(opts.toDay);
  if (!start || !to || to === start) return {};
  const end = dayPartOf(opts.currentEnd);
  if (!opts.hasEnd || !end || end <= start) return { start: to };
  const span = entryDayKeys(start, end).length - 1;
  return { start: to, end: addDays(to, span) };
}

/**
 * Sorts the rows of a timeline: by start day, then by the longer bar, then by
 * name. Deterministic, so a row does not jump while one is dragging its
 * neighbour.
 */
export function compareRows(
  a: { start: unknown; end: unknown; name: string },
  b: { start: unknown; end: unknown; name: string }
): number {
  const sa = dayPartOf(a.start);
  const sb = dayPartOf(b.start);
  if (sa !== sb) return sa < sb ? -1 : 1;
  const la = entryDayKeys(a.start, a.end).length;
  const lb = entryDayKeys(b.start, b.end).length;
  if (la !== lb) return lb - la;
  return a.name.localeCompare(b.name);
}
