import type { PimEventDraft, PimEventRow, PimRecurrenceFreq } from "@plainva/core";
import { localIsoKey } from "../dailyNotePath";

/**
 * Pure view-model of the calendar tab (PIM stage 2c): bucketing cached event
 * instances into local civil days and the small formatting helpers. All-day
 * events carry civil dates (end EXCLUSIVE, the iCal/Google convention) and
 * must never shift through timezone math; timed events bucket by the LOCAL
 * day(s) they touch.
 */

/** All local day keys (YYYY-MM-DD) an event instance covers. */
export function eventDayKeys(e: PimEventRow): string[] {
  if (e.allDay && e.start.date) {
    // Civil dates, end EXCLUSIVE: the start day plus every day strictly
    // before the end date (a broken end <= start still yields the start day).
    const out: string[] = [e.start.date];
    const endExclusive = e.end.date;
    if (endExclusive && endExclusive > e.start.date) {
      let cur = nextDate(e.start.date);
      let guard = 0;
      while (cur < endExclusive && guard < 60) {
        out.push(cur);
        cur = nextDate(cur);
        guard++;
      }
    }
    return out;
  }
  const out: string[] = [];
  const start = new Date(e.start.ts);
  // Treat a zero/negative duration as a point event; end is exclusive at
  // midnight boundaries (an event ending 00:00 does not appear on that day).
  const endTs = Math.max(e.end.ts, e.start.ts + 1);
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let guard = 0;
  while (cur.getTime() < endTs && guard < 60) {
    out.push(localIsoKey(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    guard++;
  }
  return out.length > 0 ? out : [localIsoKey(start)];
}

/** Events bucketed by local day, each day sorted all-day first, then start. */
export function bucketEventsByDay(events: PimEventRow[]): Map<string, PimEventRow[]> {
  const map = new Map<string, PimEventRow[]>();
  for (const e of events) {
    for (const key of eventDayKeys(e)) {
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.ts - b.start.ts || a.title.localeCompare(b.title));
  }
  return map;
}

/** Local day key of the event's FIRST day (meeting-note file names use it). */
export function eventStartDayKey(e: PimEventRow): string {
  if (e.allDay && e.start.date) return e.start.date;
  return localIsoKey(new Date(e.start.ts));
}

/** "10:00–10:30" for timed events, empty for all-day. */
export function formatTimeRange(e: PimEventRow, locale: string): string {
  if (e.allDay) return "";
  const fmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  return `${fmt.format(new Date(e.start.ts))}–${fmt.format(new Date(e.end.ts))}`;
}

function nextDate(date: string): string {
  return shiftDayKey(date, 1);
}

/** Day key shifted by whole days (calendar math on civil dates). */
export function shiftDayKey(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localIsoKey(new Date(y, (m ?? 1) - 1, (d ?? 1) + deltaDays));
}

// ---- event form (stage 3 create/edit dialog) -------------------------------

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
  /** Per-event colour (hex from the palette; empty = the calendar's colour). */
  color: string;
  /** Create only: "<accountId> <calendarId>" of the target calendar. */
  calendarKey: string;
  /** Create only: simple no-end recurrence ("" = none). The edit dialog never
   * shows this — an existing rule is never rewritten by the field editor. */
  repeat: "" | PimRecurrenceFreq;
}

export function emptyEventForm(dayKey: string, calendarKey: string): EventFormValues {
  return { title: "", allDay: false, dayKey, endDayKey: dayKey, startTime: "09:00", endTime: "10:00", location: "", description: "", color: "", calendarKey, repeat: "" };
}

export function eventFormFromEvent(e: PimEventRow): EventFormValues {
  const dayKey = eventStartDayKey(e);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const endInclusive = e.allDay && e.end.date ? shiftDayKey(e.end.date, -1) : dayKey;
  return {
    title: e.title,
    allDay: e.allDay,
    dayKey,
    endDayKey: endInclusive >= dayKey ? endInclusive : dayKey,
    startTime: e.allDay ? "09:00" : hhmm(new Date(e.start.ts)),
    endTime: e.allDay ? "10:00" : hhmm(new Date(e.end.ts)),
    location: e.location ?? "",
    description: e.description ?? "",
    color: e.color ?? "",
    calendarKey: `${e.accountId} ${e.calendarId}`,
    repeat: "",
  };
}

/** Dialog values -> provider draft. Timed events interpret day+HH:MM as LOCAL
 * wall clock; an end at or before the start falls back to +30 min. All-day
 * ranges convert the inclusive dialog end to the exclusive iCal end. */
export function eventFormToDraft(v: EventFormValues): PimEventDraft {
  const title = v.title.trim();
  const location = v.location.trim() || undefined;
  const description = v.description.trim() || undefined;
  const color = v.color.trim() || undefined;
  const recurrenceFreq = v.repeat || undefined;
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
      color,
      recurrenceFreq,
    };
  }
  const startTs = new Date(`${v.dayKey}T${v.startTime || "09:00"}:00`).getTime();
  let endTs = new Date(`${v.dayKey}T${v.endTime || "10:00"}:00`).getTime();
  if (!(endTs > startTs)) endTs = startTs + 30 * 60 * 1000;
  return { title, allDay: false, start: { ts: startTs }, end: { ts: endTs }, location, description, color, recurrenceFreq };
}
