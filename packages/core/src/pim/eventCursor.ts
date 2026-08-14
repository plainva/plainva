/**
 * The per-calendar cursor of the incremental event pull (C2/S18).
 *
 * Stored in the `cursor` column of `pim_state`, scope `events:<calendarId>`.
 * The provider's own token is wrapped together with the time of the last FULL
 * refresh, because that is the one thing the token itself cannot say — and a
 * safety net that never fires is not one.
 *
 * Wall clock rather than a cycle counter, unlike the file sync which carries
 * both: a counter freezes while the app is backgrounded, which is most of a
 * phone's day, and there is no second mechanism here that would catch that.
 *
 * The wrapper is ours; a provider never sees it. Anything unparseable reads as
 * "no cursor", which means a full refresh — the safe direction.
 */

export interface EventCursor {
  /** The provider's continuation token, verbatim. */
  token: string;
  /** When the last FULL refresh ran (epoch ms). */
  fullAt: number;
}

/** How long a calendar may run on deltas before a full refresh re-anchors it.
 * The delta feeds are trustworthy but not infallible; an hour bounds the damage
 * of a feed that quietly stops mentioning something without deleting it. */
export const FULL_REFRESH_MAX_AGE_MS = 60 * 60 * 1000;

export function encodeEventCursor(c: EventCursor): string {
  return JSON.stringify({ t: c.token, f: c.fullAt });
}

export function decodeEventCursor(raw: string | null | undefined): EventCursor | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { t?: unknown; f?: unknown };
    if (typeof o?.t !== "string" || !o.t) return null;
    const fullAt = typeof o.f === "number" && Number.isFinite(o.f) ? o.f : 0;
    return { token: o.t, fullAt };
  } catch {
    // A cursor written before this format existed, or a truncated write. Not an
    // error — it simply means the next run is a full refresh.
    return null;
  }
}

/**
 * Whether this calendar needs a full refresh rather than a delta step.
 *
 * True when there is no usable cursor at all, when the last full refresh has
 * aged out, or when the target cannot do deltas in the first place.
 */
export function needsFullRefresh(
  cursor: EventCursor | null,
  now: number,
  supportsDelta: boolean,
  maxAgeMs: number = FULL_REFRESH_MAX_AGE_MS
): boolean {
  if (!supportsDelta) return true;
  if (!cursor) return true;
  // A stored time in the future means the clock moved backwards (NTP
  // correction, timezone repair, a hand-set device). Reading that as "very
  // fresh" would grant an unbounded delta run until the clock caught up, so
  // it counts as aged out instead.
  if (now < cursor.fullAt) return true;
  return now - cursor.fullAt >= maxAgeMs;
}
