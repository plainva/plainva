/**
 * The three periods of a `.base` calendar — month, week, day (S20, plan P10).
 *
 * The whole thing is pure and shared, because the phone shows the same three
 * periods (S21b) and "which days does this period contain" must not be answered
 * twice. What the surfaces differ in is how much room a day gets, not which
 * days there are.
 *
 * One cursor, not two. A period and an anchor DAY, never a period and a month:
 * switching from the month to the week then shows the week that contains the
 * day one was just looking at, instead of jumping somewhere else because a
 * second piece of state remembered something different.
 */

import { startOfWeek, type WeekStartDay } from "../lib/calendarGrid";

export type CalendarRangeKind = "month" | "week" | "day";

export interface CalendarCursor {
  range: CalendarRangeKind;
  /** Anchor day, YYYY-MM-DD. */
  day: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, delta: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

/**
 * First day of the week containing `key`, honouring the user's week-start
 * setting — through the SAME helper the real calendar uses, so a vault set to
 * Sunday does not get a Monday week in its databases.
 */
export function startOfWeekKey(key: string, weekStart: WeekStartDay = 1): string {
  return dayKey(startOfWeek(parseDay(key), weekStart));
}

/**
 * The day keys the period covers, grouped into ROWS.
 *
 * A month is six rows of seven (including the leading and trailing days of the
 * neighbouring months as `null`, so the grid keeps its shape), a week is one row
 * of seven, a day is one row of one. Rows are what the span layout works on —
 * it asks per row which entry runs across which columns.
 */
export function rangeRows(cursor: CalendarCursor, weekStart: WeekStartDay = 1): (string | null)[][] {
  if (cursor.range === "day") return [[cursor.day]];
  if (cursor.range === "week") {
    const start = startOfWeekKey(cursor.day, weekStart);
    return [Array.from({ length: 7 }, (_, i) => addDays(start, i))];
  }
  const anchor = parseDay(cursor.day);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (firstDow - weekStart + 7) % 7;
  const cells: (string | null)[] = Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    return day > 0 && day <= daysInMonth ? `${year}-${pad(month + 1)}-${pad(day)}` : null;
  });
  return Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
}

/** Moves the cursor one period back or forward. */
export function stepCursor(cursor: CalendarCursor, delta: -1 | 1): CalendarCursor {
  if (cursor.range === "day") return { ...cursor, day: addDays(cursor.day, delta) };
  if (cursor.range === "week") return { ...cursor, day: addDays(cursor.day, delta * 7) };
  const d = parseDay(cursor.day);
  // Clamp to the month's length: stepping from the 31st must not skip a month.
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return { ...cursor, day: dayKey(target) };
}

/**
 * The day part of a value in a date column — `2026-08-12` and
 * `2026-08-12T14:30` both mean the 12th. Empty for anything unparseable, so a
 * malformed cell simply does not appear rather than landing on some day.
 */
export function dayPartOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1]! : "";
}

/** Minutes into the day, when the value carries a time. Undefined otherwise —
 * an entry that says "the 12th" must not be sorted as if it were at midnight. */
export function minutesOf(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** `HH:MM` for display, or "" when the entry names no time. */
export function timeLabel(value: unknown): string {
  const min = minutesOf(value);
  return min === undefined ? "" : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/**
 * Every day an entry touches, ascending — the input the span layout wants.
 *
 * Without an end column (or with one that lies before the start) an entry
 * touches exactly its own day: a span needs two ends, and inventing the second
 * would turn every ordinary entry into a bar.
 */
export function entryDayKeys(start: unknown, end?: unknown): string[] {
  const from = dayPartOf(start);
  if (!from) return [];
  const to = dayPartOf(end);
  if (!to || to <= from) return [from];
  const out: string[] = [];
  // A guard, not a policy: a mistyped year must not build a million-day array.
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) out.push(d);
  return out;
}

/** Sorts entries within a day: timed ones first in clock order, untimed after —
 * an all-day item has no place among the hours. */
export function compareByTime(a: unknown, b: unknown): number {
  const ma = minutesOf(a);
  const mb = minutesOf(b);
  if (ma === undefined && mb === undefined) return 0;
  if (ma === undefined) return 1;
  if (mb === undefined) return -1;
  return ma - mb;
}
