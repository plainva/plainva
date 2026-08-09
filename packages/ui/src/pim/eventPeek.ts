/**
 * The data behind the event PREVIEW (calendar/mail expansion, S2/S4).
 *
 * A click on an event used to open the edit form — and on a series it opened
 * the "this one or all?" question first, before anything had been changed.
 * Both are answers to a question the user did not ask: they wanted to LOOK.
 * The preview reads; only the edit action writes.
 *
 * These helpers are shared because the phone shows the same preview as a sheet
 * (S4). What a series is called, and which occurrence comes next, must not be
 * decided twice.
 *
 * They work on the rows that are LOADED — the calendar cache holds a window
 * (roughly two months back, a year ahead), not the whole series. That is why
 * `nextOccurrenceOf` can return null for a real series: the next instance may
 * simply lie outside the window. It never guesses one.
 */

import { parseRRule, type PimAttendee, type PimEvent, type PimRecurrence } from "@plainva/core";
import type { EventChangeT } from "./eventChanges";

/** An event row as the calendar holds it (the account is part of its identity). */
export interface PeekRow extends PimEvent {
  accountId: string;
}

/** Same series? Instances carry the master uid; the master carries its own. */
export function sameSeries(a: PeekRow, b: PeekRow): boolean {
  if (a.accountId !== b.accountId || a.calendarId !== b.calendarId) return false;
  const ka = a.seriesMaster ?? a.uid;
  const kb = b.seriesMaster ?? b.uid;
  return ka === kb;
}

/** Whether this row belongs to a repeating event at all. */
export function isSeries(e: PeekRow): boolean {
  return !!e.seriesMaster || !!e.recurrence;
}

/**
 * The repetition rule, read from the loaded rows: an expanded instance carries
 * `seriesMaster` but no RRULE — that lives on the master. Returns null when the
 * master is not in the window, which is a legitimate answer, not a failure.
 */
export function seriesRecurrenceOf(rows: readonly PeekRow[], event: PeekRow): PimRecurrence | null {
  if (event.recurrence) return parseRRule(event.recurrence);
  if (!event.seriesMaster) return null;
  const master = rows.find((r) => r.uid === event.seriesMaster && r.accountId === event.accountId && r.calendarId === event.calendarId);
  return master?.recurrence ? parseRRule(master.recurrence) : null;
}

/**
 * The next occurrence after this one, among the loaded rows. Masters are skipped
 * — a master row is the rule, not a date the user will attend.
 */
export function nextOccurrenceOf(rows: readonly PeekRow[], event: PeekRow): PeekRow | null {
  if (!isSeries(event)) return null;
  const after = event.start.ts;
  let best: PeekRow | null = null;
  for (const r of rows) {
    if (r.uid === event.uid) continue;
    if (!sameSeries(r, event)) continue;
    if (r.recurrence && !r.seriesMaster) continue; // the master, not an instance
    if (r.start.ts <= after) continue;
    if (!best || r.start.ts < best.start.ts) best = r;
  }
  return best;
}

/**
 * The attendee list for display: the detailed entries when the provider sent
 * them, otherwise the plain name list turned into entries with no status.
 * The organiser comes first — the preview names who called the meeting.
 */
export function peekAttendees(event: PimEvent): PimAttendee[] {
  const list: PimAttendee[] =
    event.rsvps && event.rsvps.length > 0
      ? [...event.rsvps]
      : (event.attendees ?? []).map((name) => ({ name, status: "needsAction" as const }));
  return list.sort((a, b) => Number(!!b.organizer) - Number(!!a.organizer));
}

/** How many attendees said yes — the number worth showing next to the count. */
export function acceptedCount(attendees: readonly PimAttendee[]): number {
  return attendees.filter((a) => a.status === "accepted").length;
}

/** "Do, 14. August · 10:00–11:30" — or the day alone for an all-day event. */
export function formatEventWhen(e: PeekRow, locale: string): string {
  // An all-day event carries the civil date; using its `ts` would shift the day
  // across timezones — the very thing `date` exists to prevent.
  const start = new Date(e.allDay && e.start.date ? `${e.start.date}T12:00:00` : e.start.ts);
  const day = start.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long" });
  if (e.allDay) return day;
  const hm = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${hm(new Date(e.start.ts))}–${hm(new Date(e.end.ts))}`;
}

/** "Wöchentlich, montags" — the rule in one line, built from existing keys. */
/**
 * The ICS weekday codes, Monday first — the order the editor's chip row uses.
 */
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * "Mo", "Sun", "日" — the weekday in the reader's language.
 *
 * The raw ICS token is not a name: a German preview that said "Wöchentlich · SU"
 * was reading the protocol out loud. `Intl` already knows every language we
 * ship, so there is nothing to translate and nothing to keep in step — but the
 * derivation has to live in ONE place, or the editor's chips and the preview's
 * summary end up naming the same day differently.
 */
export function weekdayCodeLabel(code: string, locale: string): string {
  const i = WEEKDAY_CODES.indexOf(code.toUpperCase() as (typeof WEEKDAY_CODES)[number]);
  // 2024-01-01 was a Monday, so index 0 lands on Monday.
  if (i < 0) return code;
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 1 + i));
}

export function describeRecurrence(r: PimRecurrence, t: EventChangeT, locale: string): string {
  const freq = {
    daily: t("pim.repeatDaily", { defaultValue: "Täglich" }),
    weekly: t("pim.repeatWeekly", { defaultValue: "Wöchentlich" }),
    monthly: t("pim.repeatMonthly", { defaultValue: "Monatlich" }),
    yearly: t("pim.repeatYearly", { defaultValue: "Jährlich" }),
  }[r.freq];
  const every =
    (r.interval ?? 1) > 1
      ? `${t("pim.repeatEvery", { defaultValue: "Alle" })} ${r.interval} ${
          { daily: t("pim.freqDay", { defaultValue: "Tag(e)" }), weekly: t("pim.freqWeek", { defaultValue: "Woche(n)" }), monthly: t("pim.freqMonth", { defaultValue: "Monat(e)" }), yearly: t("pim.freqYear", { defaultValue: "Jahr(e)" }) }[r.freq]
        }`
      : freq;
  const days = r.freq === "weekly" && r.byWeekday?.length ? r.byWeekday.map((d) => weekdayCodeLabel(d, locale)).join(", ") : "";
  return days ? `${every} · ${days}` : every;
}
