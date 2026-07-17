/**
 * Hand-off "show this day in the calendar tab" from the sidebar calendar.
 * The calendar tab may not be mounted yet when the click happens (searchJump
 * park pattern): the day is parked here AND announced via the window event —
 * a mounted tab reacts to the event, a freshly mounting tab consumes the park.
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
