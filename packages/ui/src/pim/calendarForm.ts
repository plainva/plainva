import { parseRRule, type PimEventDraft, type PimEventRow, type PimRecurrence, type PimRecurrenceFreq } from "@plainva/core";
import { markdownToHtml } from "../lib/markdownToHtml";
import { localIsoKey } from "../lib/dailyNotePath";

/**
 * The event FORM, shared (S25).
 *
 * What an event edit means is not obvious, and every rule here was learned the
 * hard way on the desktop:
 *
 *  - attendees and recurrence are only written when the user TOUCHED those
 *    controls. Editing the time of an invitation must not reset who answered
 *    what, and must not overwrite a Graph recurrence we could only read half of.
 *  - a recurrence is entered Outlook-style (frequency, interval, weekdays, an
 *    end) rather than as an RRULE, and read back from either an RRULE or the
 *    Graph pattern, because the two providers disagree about the wire format.
 *
 * A phone repeating these from scratch would eventually reset somebody's RSVPs.
 */

/** Local day key of the event's FIRST day (meeting-note file names use it). */
export function eventStartDayKey(e: PimEventRow): string {
  if (e.allDay && e.start.date) return e.start.date;
  return localIsoKey(new Date(e.start.ts));
}

/** Day key shifted by whole days (calendar math on civil dates). */
export function shiftDayKey(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localIsoKey(new Date(y, (m ?? 1) - 1, (d ?? 1) + deltaDays));
}

/** How a recurrence ends. */
export type RepeatEnd = "never" | "until" | "count";

export interface EventFormValues {
  title: string;
  allDay: boolean;
  /** Civil start day (YYYY-MM-DD). */
  dayKey: string;
  /** All-day only: INCLUSIVE civil end day (the dialog shows human-inclusive
   * ranges; the iCal exclusive end is derived on submit). */
  endDayKey: string;
  /** Timed only: local wall-clock HH:MM. */
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  /** Set true once the user edits the description so an unrelated edit (or a drag
   * reschedule) never REPLACES the remote description — which for Graph/Google/
   * CalDAV could overwrite rich HTML with the cached Markdown. */
  descriptionTouched: boolean;
  /** Per-event colour (hex from the palette; empty = the calendar's colour). */
  color: string;
  /** "<accountId> <calendarId>" of the target calendar (create picker). */
  calendarKey: string;
  /** Invitees, one email per line / comma-separated. */
  attendees: string;
  /** Set true once the user edits the invitees so an unrelated edit never
   * REPLACES the remote attendee list (which would reset RSVP status). */
  attendeesTouched: boolean;
  /** Ask the provider to email the invitees (Google `sendUpdates=all`). Default
   * on for new events with attendees, off for edits (opt-in re-notify). */
  notifyAttendees: boolean;
  // ---- recurrence (Outlook-style) ----
  repeatFreq: "" | PimRecurrenceFreq;
  repeatInterval: number;
  /** Weekly only: weekday codes MO..SU. */
  repeatByWeekday: string[];
  repeatEnd: RepeatEnd;
  repeatUntil: string; // civil date
  repeatCount: number;
  /** Set true once the user edits any recurrence control — only then is the
   * remote rule written (so editing a series' time never rewrites its rule,
   * which matters most for Graph where the rule can't be fully read back). */
  repeatTouched: boolean;
}

function baseForm(dayKey: string, calendarKey: string): EventFormValues {
  return {
    title: "", allDay: false, dayKey, endDayKey: dayKey, startTime: "09:00", endTime: "10:00",
    location: "", description: "", descriptionTouched: false, color: "", calendarKey,
    attendees: "", attendeesTouched: false, notifyAttendees: true,
    repeatFreq: "", repeatInterval: 1, repeatByWeekday: [], repeatEnd: "never", repeatUntil: "", repeatCount: 10, repeatTouched: false,
  };
}

export function emptyEventForm(dayKey: string, calendarKey: string): EventFormValues {
  return baseForm(dayKey, calendarKey);
}

export function eventFormFromEvent(e: PimEventRow): EventFormValues {
  const dayKey = eventStartDayKey(e);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const endInclusive = e.allDay && e.end.date ? shiftDayKey(e.end.date, -1) : dayKey;
  const rec = parseRRule(e.recurrence) ?? graphPatternToRecurrence(e.recurrence);
  return {
    ...baseForm(dayKey, `${e.accountId} ${e.calendarId}`),
    title: e.title,
    allDay: e.allDay,
    dayKey,
    endDayKey: endInclusive >= dayKey ? endInclusive : dayKey,
    startTime: e.allDay ? "09:00" : hhmm(new Date(e.start.ts)),
    endTime: e.allDay ? "10:00" : hhmm(new Date(e.end.ts)),
    location: e.location ?? "",
    description: e.description ?? "",
    color: e.color ?? "",
    // Prefer real addresses (rsvps) over the plain display list.
    attendees: (e.rsvps?.map((a) => a.email).filter((x): x is string => !!x) ?? e.attendees ?? []).join("\n"),
    // Editing defaults to NOT re-notifying; the user opts in per edit.
    notifyAttendees: false,
    repeatFreq: rec?.freq ?? "",
    repeatInterval: rec?.interval && rec.interval > 1 ? rec.interval : 1,
    repeatByWeekday: rec?.byWeekday ?? [],
    repeatEnd: rec?.count ? "count" : rec?.until ? "until" : "never",
    repeatUntil: rec?.until ?? "",
    repeatCount: rec?.count && rec.count > 0 ? rec.count : 10,
  };
}

/**
 * Calendar options for the EDIT dialog. The writable calendars are the move
 * TARGETS; the event's OWN calendar is always prepended as the current selection
 * — even when it is read-only or not selected (a subscribed/shared calendar) and
 * therefore absent from the writable set. It is resolved to its name via the
 * FULL calendar-name map, so the picker shows the name instead of falling back
 * to the raw "<accountId> <calendarId>" key. A series has no move picker (empty
 * list hides it). Pure.
 */

function graphPatternToRecurrence(recurrence: string | undefined): PimRecurrence | null {
  const t = (recurrence ?? "").toLowerCase();
  if (t === "daily") return { freq: "daily" };
  if (t === "weekly" || t === "relativeweekly") return { freq: "weekly" };
  if (t === "absolutemonthly" || t === "relativemonthly") return { freq: "monthly" };
  if (t === "absoluteyearly" || t === "relativeyearly") return { freq: "yearly" };
  if (t === "recurring") return { freq: "weekly" }; // unknown Graph pattern — best effort
  return null;
}

export function parseEmails(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(/[\n,;]+/)) {
    const a = raw.trim();
    const key = a.toLowerCase();
    if (a && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

/** Form recurrence controls -> a PimRecurrence (or null for "none"). */
export function formRecurrence(v: EventFormValues): PimRecurrence | null {
  if (!v.repeatFreq) return null;
  const r: PimRecurrence = { freq: v.repeatFreq };
  if (v.repeatInterval > 1) r.interval = Math.floor(v.repeatInterval);
  if (v.repeatFreq === "weekly" && v.repeatByWeekday.length > 0) r.byWeekday = v.repeatByWeekday;
  if (v.repeatEnd === "until" && v.repeatUntil) r.until = v.repeatUntil;
  else if (v.repeatEnd === "count" && v.repeatCount > 0) r.count = Math.floor(v.repeatCount);
  return r;
}

/** Dialog values -> provider draft. Timed events interpret day+HH:MM as LOCAL
 * wall clock; an end at or before the start falls back to +30 min. All-day
 * ranges convert the inclusive dialog end to the exclusive iCal end. Attendees
 * and recurrence are only written when the user touched them (else undefined =
 * leave the remote value untouched). */
export function eventFormToDraft(v: EventFormValues): PimEventDraft {
  const title = v.title.trim();
  const location = v.location.trim() || undefined;
  // Touched-guard: only write the description when the user edited it; else
  // undefined leaves the remote value (incl. provider HTML) untouched. The field
  // is canonical Markdown; descriptionHtml is the rendered HTML for providers
  // that accept it (Graph/Google body, CalDAV X-ALT-DESC).
  const description = v.descriptionTouched ? v.description.trim() : undefined;
  const descriptionHtml = description === undefined ? undefined : description ? markdownToHtml(description) : "";
  const color = v.color.trim() || undefined;
  const attendees = v.attendeesTouched ? parseEmails(v.attendees) : undefined;
  const recurrence = v.repeatTouched ? formRecurrence(v) : undefined;
  // Only meaningful when there ARE invitees; harmless otherwise, but gate it so
  // an attendee-less event never sends sendUpdates.
  const notifyAttendees = v.notifyAttendees && parseEmails(v.attendees).length > 0 ? true : undefined;
  if (v.allDay) {
    const startKey = v.dayKey;
    const endInclusive = v.endDayKey && v.endDayKey >= startKey ? v.endDayKey : startKey;
    const endExclusive = shiftDayKey(endInclusive, 1);
    return {
      title,
      allDay: true,
      start: { ts: Date.parse(`${startKey}T00:00:00Z`), date: startKey },
      end: { ts: Date.parse(`${endExclusive}T00:00:00Z`), date: endExclusive },
      location,
      description,
      descriptionHtml,
      color,
      attendees,
      recurrence,
      notifyAttendees,
    };
  }
  const startTs = new Date(`${v.dayKey}T${v.startTime || "09:00"}:00`).getTime();
  let endTs = new Date(`${v.dayKey}T${v.endTime || "10:00"}:00`).getTime();
  if (!(endTs > startTs)) endTs = startTs + 30 * 60 * 1000;
  return { title, allDay: false, start: { ts: startTs }, end: { ts: endTs }, location, description, descriptionHtml, color, attendees, recurrence, notifyAttendees };
}
