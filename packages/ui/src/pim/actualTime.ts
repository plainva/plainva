/**
 * Actual time — how long a task really took, read from the calendar entries it
 * was blocked into.
 *
 * `plainva.blocks[]` has existed since "block time" shipped: an anchor per
 * calendar entry, carrying uid/account/calendar/start. It had NO reader. This
 * is the first one, and it deliberately reads the DURATION from the calendar
 * cache rather than storing one — the anchor points at an entry the user can
 * move and resize, so any duration written into the note would be wrong the
 * moment they did.
 *
 * Decision E5: without a calendar account there is a DASH, not a zero. "Not
 * measured" and "measured, and it is none" are different statements, and a
 * zero next to a planned effort reads as the second one.
 */

export interface BlockAnchorLike {
  uid: string;
  accountId?: string;
  calendarId?: string;
}

/** Minimal shape of a cached calendar entry — start/end as ISO strings. */
export interface TimedEntry {
  uid: string;
  start: string;
  end: string;
}

export interface ActualTime {
  /** Minutes across all anchored entries that could be resolved. */
  minutes: number;
  /** Anchors whose entry was not in the cache — the number is short by these. */
  missing: number;
}

/**
 * Sum the durations of the entries these anchors point at.
 *
 * Returns null when there is nothing to look in — no anchors at all, or no
 * calendar data. That null is what becomes the dash: a task nobody blocked
 * time for has no measured time, and saying "0 h" would claim it was worked on
 * for no time at all.
 */
export function actualTimeOf(
  anchors: readonly BlockAnchorLike[],
  entriesByUid: ReadonlyMap<string, TimedEntry>
): ActualTime | null {
  if (anchors.length === 0) return null;
  let minutes = 0;
  let missing = 0;
  let hit = 0;
  const seen = new Set<string>();
  for (const a of anchors) {
    if (!a.uid || seen.has(a.uid)) continue;
    seen.add(a.uid);
    const entry = entriesByUid.get(a.uid);
    if (!entry) {
      missing += 1;
      continue;
    }
    const ms = Date.parse(entry.end) - Date.parse(entry.start);
    if (!Number.isFinite(ms) || ms <= 0) {
      missing += 1;
      continue;
    }
    minutes += Math.round(ms / 60_000);
    hit += 1;
  }
  // Every anchor unresolvable means the calendar simply is not there — that is
  // the dash case, not a measurement of zero.
  if (hit === 0) return null;
  return { minutes, missing };
}

/** "1:45 h" — minutes are what the file stores, hours are what people read. */
export function formatMinutesAsHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}
