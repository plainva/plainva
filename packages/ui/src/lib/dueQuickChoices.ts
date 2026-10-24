import type { WeekStartDay } from "./calendarGrid";
import { addDaysToKey } from "./taskPlanner";
import { minutesToHHMM } from "./timeGrid";

/**
 * The quick choices of "Change due date" (wishes 2026-10-24, E2): Today,
 * Tomorrow, This weekend, Next week, No date — as in Apple Reminders. ONE
 * definition for the desktop's popover and the phone's sheet (`DuePicker`).
 *
 * Every date is calendar arithmetic on day keys (`addDaysToKey`): no time zone
 * and no daylight-saving change can move a day.
 */

export type DueQuickId = "today" | "tomorrow" | "weekend" | "nextWeek" | "none";

export interface DueQuickChoice {
  id: DueQuickId;
  /** The day the choice stands for; null for "No date". */
  day: string | null;
}

/** What a due picker answers: a day (null = no date) and a time of day (`HH:MM`, null = all day). */
export interface DuePick {
  day: string | null;
  time: string | null;
}

/** A time of day as the picker writes it: 24-hour `HH:MM`. */
export const DUE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 0 = Sunday … 6 = Saturday, as `Date.getDay()` counts and as `WeekStartDay` does. */
function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "This weekend": the coming Saturday. On a Saturday that is today — and on a
 * Sunday too: the weekend is still on, and the next Saturday would be next
 * weekend, which is a different promise.
 */
export function thisWeekendDay(todayKey: string): string {
  const weekday = weekdayOf(todayKey);
  if (weekday === 6 || weekday === 0) return todayKey;
  return addDaysToKey(todayKey, 6 - weekday);
}

/**
 * "Next week": the first day of the week after this one, where the week-start
 * setting says a week starts (Monday, Sunday or Saturday) — never today, at
 * most seven days ahead.
 */
export function nextWeekStartDay(todayKey: string, weekStart: WeekStartDay): string {
  const intoWeek = (weekdayOf(todayKey) - weekStart + 7) % 7;
  return addDaysToKey(todayKey, 7 - intoWeek);
}

/**
 * The day one quick choice stands for. Quick capture reads its words for
 * today, tomorrow and next week through this too (`parseTaskCapture`), so a
 * typed "next week" and the tapped "Next week" never name different days.
 */
export function dueQuickDay(id: Exclude<DueQuickId, "none">, todayKey: string, weekStart: WeekStartDay): string {
  switch (id) {
    case "today":
      return todayKey;
    case "tomorrow":
      return addDaysToKey(todayKey, 1);
    case "weekend":
      return thisWeekendDay(todayKey);
    case "nextWeek":
      return nextWeekStartDay(todayKey, weekStart);
  }
}

/** The five quick choices in the order they are shown. */
export function dueQuickChoices(todayKey: string, weekStart: WeekStartDay): DueQuickChoice[] {
  const ids = ["today", "tomorrow", "weekend", "nextWeek"] as const;
  return [...ids.map((id) => ({ id, day: dueQuickDay(id, todayKey, weekStart) })), { id: "none", day: null }];
}

/** The time a task carries now, as the picker shows it — from the row's `dueMinutes`. */
export function dueTimeOf(minutes: number | null | undefined): string | null {
  return minutes == null ? null : minutesToHHMM(minutes);
}
