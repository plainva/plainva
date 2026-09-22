import { calendarDay } from "@plainva/ui";

/**
 * Local-time YYYY-MM-DD (daily-note naming).
 *
 * The phone used to rebuild this key itself; it now asks the one function both
 * shells share (plan Journal-Erweiterungen, X1). The name stays for its
 * callers. A daily note or a journal entry asks `journalDay` instead when the
 * vault has a day boundary — this one is the calendar's answer and never
 * shifts.
 */
export const isoOf = calendarDay;
