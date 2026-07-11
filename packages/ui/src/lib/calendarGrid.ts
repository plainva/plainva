import { getISOWeek } from "date-fns";

/** First day of the month containing `d` (local time). */
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** 6x7 day grid starting on the Monday on/before the 1st of the month. */
export function buildMonthCells(viewDate: Date): Date[] {
  const first = startOfMonth(viewDate);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
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
