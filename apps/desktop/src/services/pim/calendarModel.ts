import type { PimEventRow } from "@plainva/core";
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

// `eventDayKeys` and `shiftDayKey` moved to @plainva/ui (S5): the phone needs
// the same answer, and it had none — its month view bucketed by the START day
// alone. Re-exported so every existing import path keeps working.
export { eventDayKeys, shiftDayKey } from "@plainva/ui";
import { eventDayKeys } from "@plainva/ui";

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


// The time-block slice (picker rules, HH:MM helpers, the event draft) moved
// to @plainva/ui (S24) so the phone blocks time through the same code, and the
// block draft followed it (C33); re-exported here so every existing import
// path keeps working.
export {
  buildBlockDraft,
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




