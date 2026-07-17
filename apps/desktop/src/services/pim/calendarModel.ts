import type { PimEventRow } from "@plainva/core";
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
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1);
  return localIsoKey(next);
}
