/**
 * Hand-off "show this day in the calendar" — from the sidebar calendar, a
 * reminder, the assistant's `open-calendar` with a day (plan KI-Harness P4-4).
 * The calendar may not be mounted yet when it is asked (searchJump park
 * pattern): the day is parked here AND announced via the window event — a
 * mounted calendar reacts to the event, a freshly mounting one consumes the
 * park. Both shells share it since the assistant opens the calendar in both.
 */

export const CALENDAR_GOTO_EVENT = "plainva-calendar-goto-day";

let pendingDay: string | null = null;

export function requestCalendarDay(dayKey: string): void {
  pendingDay = dayKey;
  window.dispatchEvent(new CustomEvent(CALENDAR_GOTO_EVENT, { detail: { dayKey } }));
}

export function consumePendingCalendarDay(): string | null {
  const v = pendingDay;
  pendingDay = null;
  return v;
}
