/**
 * The "Recent" list, grouped by the day a note was opened (plan Rückmeldungen
 * 2026-10-24, E8).
 *
 * The phone's home screen shows the most recently opened notes as a band that
 * scrolls sideways; a tester needed too many swipes to reach its end. The
 * band's heading now opens the whole list, and a list of twenty names reads
 * better under days than as one run: Today, Yesterday, then the dates.
 *
 * "Which day" is the CALENDAR's answer (`calendarDay`), not the journal's: a
 * note opened at 01:30 was opened on that date, whatever the vault's diary day
 * boundary says.
 */

import { calendarDay } from "./today";

export type RecentDayKind = "today" | "yesterday" | "day" | "earlier";

export interface RecentDayGroup<T> {
  /** Stable key for rendering: the local `YYYY-MM-DD`, or `earlier`. */
  key: string;
  kind: RecentDayKind;
  /** The local day (`YYYY-MM-DD`) for `today`, `yesterday` and `day`. */
  day?: string;
  items: T[];
}

/**
 * Groups entries by the local day of their time stamp, newest first.
 *
 * Entries keep their relative order inside a day when their times tie. An
 * entry without a time (a recents file written before the field existed reads
 * as 0) cannot be placed on a day: it goes into one last `earlier` group, in
 * the order it came, rather than under 1 January 1970.
 */
export function groupRecentsByDay<T>(
  entries: readonly T[],
  timeOf: (entry: T) => number | undefined,
  now: Date,
): Array<RecentDayGroup<T>> {
  const today = calendarDay(now);
  const before = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = calendarDay(before);

  const dated = entries
    .map((entry, index) => ({ entry, index, at: timeOf(entry) ?? 0 }))
    .filter((e) => e.at > 0)
    .sort((a, b) => b.at - a.at || a.index - b.index);
  const undated = entries.filter((entry) => !((timeOf(entry) ?? 0) > 0));

  const groups: Array<RecentDayGroup<T>> = [];
  for (const { entry, at } of dated) {
    const day = calendarDay(new Date(at));
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.items.push(entry);
      continue;
    }
    const kind: RecentDayKind = day === today ? "today" : day === yesterday ? "yesterday" : "day";
    groups.push({ key: day, kind, day, items: [entry] });
  }
  if (undated.length > 0) groups.push({ key: "earlier", kind: "earlier", items: [...undated] });
  return groups;
}

/**
 * The heading of one group. Today and Yesterday by name, any other day as its
 * weekday and date in the app language (with the year only when it is not
 * this year's), and the undated rest as "Earlier".
 */
export function recentDayLabel(
  group: Pick<RecentDayGroup<unknown>, "kind" | "day">,
  words: { today: string; yesterday: string; earlier: string },
  locale: string,
  now: Date,
): string {
  if (group.kind === "today") return words.today;
  if (group.kind === "yesterday") return words.yesterday;
  if (group.kind === "earlier" || !group.day) return words.earlier;
  const [y, m, d] = group.day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/** The time of an open, in the clock of the app's language (`14:05`, `2:05 PM`). */
export function recentTimeLabel(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}
