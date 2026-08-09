/**
 * Which civil days an event instance covers — shared, because both shells need
 * the same answer (S5).
 *
 * This lived only in the desktop's calendar model, and the phone therefore had
 * no answer at all: its month view bucketed events by their START day, so a
 * three-day trip appeared on day one and nowhere else. That is the same defect
 * the bars fix on the desktop, one layer lower — the days did not know about
 * each other because nobody ever asked.
 *
 * All-day events carry civil dates with an EXCLUSIVE end (the iCal/Google
 * convention) and must never be shifted through timezone math; timed events
 * bucket by the LOCAL days they touch.
 */

import type { PimEventRow } from "@plainva/core";
import { localIsoKey } from "../lib/dailyNotePath";
// The civil-date arithmetic already lives with the event form — one definition,
// not a second one that could drift by a day at a DST boundary.
import { shiftDayKey } from "./calendarForm";

/** All local day keys (YYYY-MM-DD) an event instance covers. */
export function eventDayKeys(e: PimEventRow): string[] {
  if (e.allDay && e.start.date) {
    // Civil dates, end EXCLUSIVE: the start day plus every day strictly
    // before the end date (a broken end <= start still yields the start day).
    const out: string[] = [e.start.date];
    const endExclusive = e.end.date;
    if (endExclusive && endExclusive > e.start.date) {
      let cur = shiftDayKey(e.start.date, 1);
      let guard = 0;
      while (cur < endExclusive && guard < 60) {
        out.push(cur);
        cur = shiftDayKey(cur, 1);
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
