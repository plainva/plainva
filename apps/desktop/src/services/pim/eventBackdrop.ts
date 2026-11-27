import { eventDayKeys, listShownEvents, type ShownEventsCache } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";

/**
 * Real appointments behind a database's calendar view (S18, plan P9a — the
 * other direction).
 *
 * The point is stated in the plan in one sentence: "man sieht, wogegen man
 * plant". So this is deliberately a BACKDROP and nothing more — a count and a
 * couple of titles per day, quiet, not clickable. An appointment inside a
 * database view must not look like a row of that database; the moment it does,
 * a reader can no longer tell what the view actually contains.
 */

export interface BackdropDay {
  count: number;
  /** The first few titles, for the day's tooltip. */
  titles: string[];
}

export interface BackdropRuntime {
  cache: ShownEventsCache;
}

/** Loads the events of one month, bucketed by local day key. */
export async function loadEventBackdrop(
  runtime: BackdropRuntime,
  year: number,
  month: number
): Promise<Map<string, BackdropDay>> {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  // With the events on their way, as every calendar surface shows them (issue 119).
  const rows = await listShownEvents(runtime.cache, from, to);
  return bucketBackdrop(rows);
}

/** Pure half, so the bucketing is testable without a cache. */
export function bucketBackdrop(rows: readonly PimEventRow[]): Map<string, BackdropDay> {
  const out = new Map<string, BackdropDay>();
  for (const row of rows) {
    // A multi-day appointment occupies every day it covers — the backdrop
    // answers "what else is on this day", and a span is on all of them.
    for (const key of eventDayKeys(row)) {
      const day = out.get(key) ?? { count: 0, titles: [] };
      day.count += 1;
      if (day.titles.length < 3 && row.title) day.titles.push(row.title);
      out.set(key, day);
    }
  }
  return out;
}
