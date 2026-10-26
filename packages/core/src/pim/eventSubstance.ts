import type { PimEvent } from "./types.js";
import { normalizeTitle } from "./seriesTitle.js";

/**
 * What an event IS, as opposed to how a server happens to spell it (issue 119,
 * plan Rückmeldungen 2026-10-26, R2).
 *
 * An etag changes with every byte of an object. A server that rewrites what it
 * was sent — iCloud adds its own properties, re-folds lines, converts times to
 * a zone — hands out a new etag without anything having happened to the
 * appointment, and a delete guarded by the old one is refused. Asking the
 * person "changed elsewhere?" then is a question about nothing.
 *
 * So after a refusal the object is read once more and compared on this: the
 * same instance, the same start, the same rule, the same title. If that holds,
 * the write is repeated with the new etag; if not, somebody really changed the
 * appointment and the person decides.
 *
 * `SEQUENCE` is deliberately not part of it, although RFC 5545 counts it as the
 * revision: Plainva raises it on every one of its own writes, and the row the
 * view holds learns the raised value only with the next pull. Comparing it
 * would turn the person's own edit, made a second earlier, into "changed
 * elsewhere" — the very report this exists to end. What a raised `SEQUENCE`
 * announces that matters for a deletion (a new time, a new rule) is compared
 * directly.
 */
export interface PimEventSubstance {
  /** The instance key: the event id, `uid#<recurrence-id>` for an occurrence. */
  uid: string;
  /** Start instant; for an all-day event also its civil date. Absent: not known to the caller. */
  start?: { ts: number; date?: string };
  /** The rule, normalized; `""` for an event that does not repeat. Absent: not known (an occurrence row). */
  recurrence?: string;
  /** The title, trimmed. */
  title: string;
}

/**
 * The rule text in one spelling: parts upper-cased and sorted, so that a server
 * which writes `BYDAY=MO;FREQ=WEEKLY` for `FREQ=WEEKLY;BYDAY=MO` is not taken
 * for a change. The bare `RRULE` the cache keeps for a series whose rule it has
 * not read says nothing about the rule at all.
 */
export function normalizeRRule(raw: string | null | undefined): string | undefined {
  const text = (raw ?? "").trim().replace(/^RRULE:?/i, "");
  if (!text) return (raw ?? "").trim() ? undefined : "";
  return text
    .split(";")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(";");
}

/** The substance of an event as a view or a pull holds it. */
export function eventSubstanceOf(event: Pick<PimEvent, "uid" | "title" | "start" | "allDay" | "recurrence" | "seriesMaster">): PimEventSubstance {
  // An occurrence row does not carry the rule of its series: unknown, not "none".
  const recurrence = event.seriesMaster ? undefined : normalizeRRule(event.recurrence);
  // A series whose rule is not known is one addressed through an occurrence
  // (`seriesDeleteSubject`): its start is that occurrence's, not the series'.
  const startKnown = !!event.seriesMaster || recurrence !== undefined;
  return {
    uid: event.uid,
    ...(startKnown ? { start: { ts: event.start.ts, ...(event.allDay && event.start.date ? { date: event.start.date } : {}) } } : {}),
    ...(recurrence !== undefined ? { recurrence } : {}),
    title: normalizeTitle(event.title),
  };
}

/**
 * Whether `actual` is still the event the caller saw as `expected`. Only what
 * both sides know is compared; the instance and the title always are.
 */
export function sameEventSubstance(expected: PimEventSubstance, actual: PimEventSubstance): boolean {
  if (expected.uid !== actual.uid) return false;
  if (normalizeTitle(expected.title) !== normalizeTitle(actual.title)) return false;
  if (expected.start && actual.start) {
    // A civil date on one side only: the event became (or stopped being) all-day.
    if (expected.start.date || actual.start.date) {
      if ((expected.start.date ?? "") !== (actual.start.date ?? "")) return false;
    } else if (expected.start.ts !== actual.start.ts) return false;
  }
  if (expected.recurrence !== undefined && actual.recurrence !== undefined && expected.recurrence !== actual.recurrence) return false;
  return true;
}
