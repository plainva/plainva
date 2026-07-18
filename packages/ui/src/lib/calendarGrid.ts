import { getISOWeek } from "date-fns";

/** First day of the month containing `d` (local time). */
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** 6x7 day grid starting on the Monday on/before the 1st of the month. */
export function buildMonthCells(viewDate: Date, weekStart: WeekStartDay = 1): Date[] {
  const first = startOfMonth(viewDate);
  const firstWeekday = (first.getDay() - weekStart + 7) % 7; // 0 = the chosen week start
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** First day of the week as a JS getDay() value: 1 = Monday (default),
 * 6 = Saturday, 0 = Sunday — the three standard conventions. */
export type WeekStartDay = 0 | 1 | 6;

/** The start of the week containing `date` for the given week-start day. */
export function startOfWeek(date: Date, weekStart: WeekStartDay = 1): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return d;
}

/** The 7 days of the week containing `date`, starting at the week-start day. */
export function buildWeekCells(date: Date, weekStart: WeekStartDay = 1): Date[] {
  const start = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** `count` contiguous days starting at `start` (local, from midnight). Used by
 * the day (count=1) and 3-day (count=3) calendar views. */
export function buildContiguousDays(start: Date, count: number): Date[] {
  const base = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d;
  });
}

/**
 * ISO-8601 week number per grid row, taken from the row's Monday (rows always
 * start on Monday, so this is the calendar week of the whole row — including
 * the year-boundary cases where late December already belongs to week 1 or
 * early January still belongs to week 52/53).
 */
export function isoWeeksForCells(cells: Date[]): number[] {
  const weeks: number[] = [];
  for (let r = 0; r + 6 < cells.length; r += 7) weeks.push(getISOWeek(cells[r]));
  return weeks;
}
