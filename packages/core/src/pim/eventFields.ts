/**
 * Small shared helpers for the event fields every provider carries but each one
 * words differently (S9).
 */

/**
 * Reminder offsets in minutes, ascending and de-duplicated.
 *
 * Two providers can describe the same reminder twice — CalDAV allows several
 * VALARMs with the same trigger, Google several overrides differing only in
 * their delivery method (popup and email). The person reading the calendar is
 * reminded ONCE at that moment, so the list says when, not how often.
 *
 * Negative and non-finite values are dropped rather than clamped: they do not
 * describe a moment before the start, and inventing one would be worse than
 * leaving it out.
 */
export function sortedMinutes(values: Array<number | undefined | null>): number[] {
  const out = new Set<number>();
  for (const v of values) if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.add(v);
  return [...out].sort((a, b) => a - b);
}
