import type { PimEventDraft, PimEventRow, PimRecurrence } from "@plainva/core";
import { markdownToHtml } from "@plainva/ui";
import { localIsoKey } from "@plainva/ui";

/**
 * Pure view-model of the calendar tab (PIM stage 2c): bucketing cached event
 * instances into local civil days and the small formatting helpers. All-day
 * events carry civil dates (end EXCLUSIVE, the iCal/Google convention) and
 * must never shift through timezone math; timed events bucket by the LOCAL
 * day(s) they touch.
 */

/** Display title with a localized fallback for provider events (Google/Microsoft,
 * recurring instances) whose summary/subject is empty — otherwise they render as
 * a blank chip. Trims so whitespace-only titles fall back too. */
export function eventDisplayTitle(title: string, fallback: string): string {
  return title.trim() || fallback;
}

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

// The event FORM (values, touched guards, recurrence round-trip) moved to
// @plainva/ui (S25) so the phone edits an event the same way; re-exported so
// every existing import path keeps working.
export {
  type RepeatEnd,
  type EventFormValues,
  emptyEventForm,
  eventFormFromEvent,
  formRecurrence,
  eventFormToDraft,
  parseEmails,
} from "@plainva/ui";

export function buildEditCalendarOptions(
  e: PimEventRow,
  writableOptions: Array<{ value: string; label: string }>,
  calName: Map<string, string>,
  accountLabel: Map<string, string>,
  multiAccount: boolean
): Array<{ value: string; label: string }> {
  if (e.seriesMaster || e.recurrence) return [];
  const currentKey = `${e.accountId} ${e.calendarId}`;
  if (writableOptions.some((o) => o.value === currentKey)) return writableOptions;
  const name = calName.get(currentKey) || e.calendarId;
  const label = multiAccount ? `${name} · ${accountLabel.get(e.accountId) ?? ""}` : name;
  return [{ value: currentKey, label }, ...writableOptions];
}

/** Builds a draft that mirrors an event into ANOTHER calendar as a blocker
 * (calendar #1, Notion-Calendar style): either an opaque "Busy" placeholder or
 * a full copy with details. A recurrence (from the source series' master) makes
 * the block recur too. Pure. */
export function buildBlockDraft(
  e: Pick<PimEventRow, "uid" | "title" | "allDay" | "start" | "end" | "location" | "description">,
  mode: "busy" | "details",
  busyLabel: string,
  recurrence?: PimRecurrence | null
): PimEventDraft {
  return {
    title: mode === "busy" ? busyLabel : e.title,
    allDay: e.allDay,
    start: e.allDay && e.start.date ? { ts: e.start.ts, date: e.start.date } : { ts: e.start.ts },
    end: e.allDay && e.end.date ? { ts: e.end.ts, date: e.end.date } : { ts: e.end.ts },
    location: mode === "details" ? e.location ?? undefined : undefined,
    description: mode === "details" ? e.description ?? undefined : undefined,
    descriptionHtml: mode === "details" && e.description ? markdownToHtml(e.description) : undefined,
    recurrence: recurrence ?? undefined,
    blockOf: e.uid,
  };
}

// The time-block slice (picker rules, HH:MM helpers, the event draft) moved
// to @plainva/ui (S24) so the phone blocks time through the same code;
// re-exported here so every existing import path keeps working.
export {
  writableCalendarsOf,
  calendarPickerOptions,
  resolveDefaultCalendarKey,
  splitCalendarKey,
  nextHalfHourMinutes,
  minutesToTime,
  timeToMinutes,
  buildTaskBlockDraft,
} from "@plainva/ui";
export type { TaskBlockValues } from "@plainva/ui";

/** Adds the derived reverse linkage used by the calendar UI. A block whose
 * original is outside the loaded window remains a normal ungrouped block. */
export function linkCalendarBlocks(events: PimEventRow[]): PimEventRow[] {
  const byUid = new Map(events.filter((e) => !e.blockOf).map((e) => [e.uid, e]));
  const blocked = new Map<string, Array<{ accountId: string; calendarId: string; uid: string }>>();
  for (const event of events) {
    if (!event.blockOf || !byUid.has(event.blockOf)) continue;
    const list = blocked.get(event.blockOf) ?? [];
    list.push({ accountId: event.accountId, calendarId: event.calendarId, uid: event.uid });
    blocked.set(event.blockOf, list);
  }
  return events.map((event) => {
    const refs = blocked.get(event.uid);
    return refs?.length ? { ...event, blockedIn: refs } : event;
  });
}




