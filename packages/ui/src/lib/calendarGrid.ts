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

/**
 * The ISO week a run of days lies in, as the label a time grid's title carries
 * ("KW 43", "KW 43–44" when three days cross a Monday). `weekShort` is the
 * localized prefix (`calendar.weekShort`). Empty for no days.
 */
/**
 * A run of days as one label in the app language: "26. Okt. – 1. Nov.",
 * "2.–8. Nov.", "Oct 26 – Nov 1". The language decides the shape through
 * `formatRange`; both calendars used to glue a fixed "." after the first day,
 * which read "26.–Nov 1" in English (feedback 2026-10-29). A single day is
 * the day itself; without `formatRange` the two ends are joined by a dash.
 */
export function dayRangeLabel(first: Date, last: Date, language: string, month: "short" | "long" = "short"): string {
  const fmt = new Intl.DateTimeFormat(language, { day: "numeric", month });
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth() && first.getDate() === last.getDate()) {
    return fmt.format(first);
  }
  const range = (fmt as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }).formatRange;
  return typeof range === "function" ? range.call(fmt, first, last) : `${fmt.format(first)} – ${fmt.format(last)}`;
}

export function isoWeekLabel(days: Date[], weekShort: string): string {
  if (days.length === 0) return "";
  const first = getISOWeek(days[0]);
  const last = getISOWeek(days[days.length - 1]);
  return first === last ? `${weekShort} ${first}` : `${weekShort} ${first}–${last}`;
}

/**
 * Short weekday names in the app language, rotated to the chosen week start
 * (2024-01-01 was a Monday). One implementation for the calendar tab, the
 * sidebar widget and the date jump picker — the date field used to carry
 * German literals in every language (plan Kalender 2026-09-10, P1).
 */
export function weekdayShortNames(lang: string, weekStart: WeekStartDay = 1): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + ((weekStart - 1 + 7 + i) % 7))));
}

/** Short month names (Jan … Dec) in the app language. */
export function monthShortNames(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { month: "short" });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2024, i, 1)));
}
