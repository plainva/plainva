import type { PimEvent } from "./types.js";

/**
 * Series titles (S8).
 *
 * A recurring appointment normally names itself once, on the series master, and
 * every occurrence borrows that name. Providers therefore hand back occurrences
 * with no summary at all — which means "same as the series", not "an event with
 * no name". Read as a name, it produced the placeholder chip the maintainer saw.
 *
 * S7 measured where that goes wrong, and it was not where the plan expected:
 * of the three adapters only CalDAV even tried a fallback, and its `??` chain
 * missed the shape that actually occurs (an EMPTY `SUMMARY:` line yields `""`,
 * which `??` lets through). Google and Graph wrote `?? ""` with no fallback at
 * all, and nothing downstream ever looked at the master again — the cache stores
 * what the adapter produced, and the views only substitute a placeholder.
 */

/**
 * A title that is only whitespace is not a title. Every comparison here goes
 * through this, so `""`, `"   "` and a missing value are the same thing — the
 * distinction between them is an accident of the provider, never a decision by
 * the person who wrote the appointment.
 */
export function normalizeTitle(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Gives every series occurrence without its own title the title of its series.
 *
 * The answer is already in hand: all three adapters fetch the master row in the
 * same pull (that is where the recurrence badge comes from) and stamp
 * `seriesMaster` on the occurrences. So this costs no extra request — it only
 * stops throwing away what was already fetched.
 *
 * An occurrence whose master is missing — unreadable, or a series that starts
 * outside the pulled window — keeps its empty title and renders as the
 * placeholder. That is honest: the name is genuinely unknown here, and inventing
 * one would be worse than admitting it.
 *
 * Returns the same array when nothing needed filling in.
 */
export function inheritSeriesTitles(events: PimEvent[]): PimEvent[] {
  const named = new Map<string, string>();
  for (const e of events) {
    const title = normalizeTitle(e.title);
    if (title) named.set(e.uid, title);
  }

  let changed = false;
  const out = events.map((e) => {
    if (!e.seriesMaster || normalizeTitle(e.title)) return e;
    const inherited = named.get(e.seriesMaster);
    if (!inherited) return e;
    changed = true;
    return { ...e, title: inherited };
  });
  return changed ? out : events;
}
