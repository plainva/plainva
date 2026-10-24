/**
 * The appointment a calendar opened from a reminder lands on, and how it
 * crosses the nav stack.
 *
 * A tapped reminder names an appointment; the shell pushes the calendar, and
 * the calendar's route reads the appointment back out of the entry's path. The
 * two sides were two modules that each declared this type for themselves, with
 * the path spelled as `JSON.stringify(focus)` in the shell between them.
 * Nothing was wrong with it — and nothing held it together. That is the shape
 * in which a mail draft lost its attachment and the mail tab its read state
 * (screens/mail/mailNavRefs.ts): a field one side learns and the other never
 * hears of. So here, too: one type, the writer beside the reader, and a test
 * that takes a focus through both.
 *
 * The format is stored. A pushed calendar comes back after a restart
 * (services/sessionState.ts), so a path written by an older build is still
 * read. The reader is total — an empty or foreign path is simply "no focus",
 * because a nav entry must never crash the shell.
 */

/** The appointment a tapped reminder points at — enough to find it in the cache. */
export interface CalendarFocus {
  uid: string;
  accountId: string;
  calendarId: string;
  startTs: number;
}

/** A focus as the path of its `pimcalendar` entry; no focus is the empty path. */
export function calendarFocusPath(focus?: CalendarFocus): string {
  if (!focus) return "";
  return JSON.stringify({ uid: focus.uid, accountId: focus.accountId, calendarId: focus.calendarId, startTs: focus.startTs });
}

/** Path → focus; an empty or foreign path is simply "no focus". */
export function parseCalendarFocus(path: string): CalendarFocus | undefined {
  if (!path) return undefined;
  try {
    const v = JSON.parse(path) as Partial<CalendarFocus>;
    if (typeof v.uid === "string" && typeof v.accountId === "string" && typeof v.calendarId === "string" && typeof v.startTs === "number") {
      return { uid: v.uid, accountId: v.accountId, calendarId: v.calendarId, startTs: v.startTs };
    }
  } catch {
    /* not a focus */
  }
  return undefined;
}
