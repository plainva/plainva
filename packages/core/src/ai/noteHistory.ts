import { noteBodyOf } from "../frontmatter-block.js";
import { linesGained } from "./folderLog.js";

/**
 * How notes developed (plan KI-Harness P9-1, § 18 "Verlaufsanalyse"): from
 * the version history this device keeps, the state of a note at a moment and
 * what it gained from one day to the next.
 *
 * A kept state is the text before the write it was taken for (the version
 * history's snapshots, at most one every two minutes). So a note's text as
 * it stood at a moment is the first state kept after that moment — and where
 * none was kept after it, the text it has now.
 *
 * What a note lost is a number and never a text, as in a folder's log (ADR
 * 0033, decision 13): a line somebody deleted is not shown to any model.
 */

/** One kept state of a note: the handle to read it with, and when it was taken. */
export interface KeptState {
  id: string;
  at: number;
}

/** The state that holds a note's text as it stood at `t`: the first one kept after `t`; null where none was kept after it (then the text now is that state). */
export function stateHolding(kept: readonly KeptState[], t: number): KeptState | null {
  let best: KeptState | null = null;
  for (const state of kept) if (state.at > t && (best === null || state.at < best.at)) best = state;
  return best;
}

/**
 * Where a period's change of a note starts: the state at its beginning, or —
 * where none was kept after it — the newest state kept before it, the
 * nearest earlier text there is (the rule of a folder's log). Null where no
 * state was ever kept: then there is nothing to compare with.
 */
export function stateBefore(kept: readonly KeptState[], since: number): KeptState | null {
  const after = stateHolding(kept, since);
  if (after) return after;
  let newest: KeptState | null = null;
  for (const state of kept) if (state.at <= since && (newest === null || state.at > newest.at)) newest = state;
  return newest;
}

/** The latest moment in `(from, to]` at which a state was kept — a write happened right after it; null where there is none. */
export function lastKeptWithin(kept: readonly KeptState[], from: number, to: number): number | null {
  let last: number | null = null;
  for (const state of kept) if (state.at > from && state.at <= to && (last === null || state.at > last)) last = state.at;
  return last;
}

/**
 * When a note was made, as far as its history agrees: the index's time —
 * unless a state was kept at or before it, which shows that the note was
 * there already (a vault the index first saw later than its notes were
 * written). Null where neither tells.
 */
export function madeAt(created: number | null, kept: readonly KeptState[]): number | null {
  if (created === null) return null;
  return kept.some((state) => state.at <= created) ? null : created;
}

/** At most this many days in one history of a note. */
export const NOTE_HISTORY_DAYS_MAX = 31;
/** What a day of a note's history shows of the lines it gained, at most (the rest is counted). */
export const NOTE_HISTORY_DAY_CHARS = 600;

/** A local day (`YYYY-MM-DD`) of a date. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The start of a local day given as `YYYY-MM-DD`; null for anything else or a day that does not exist. */
export function startOfLocalDay(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDay(date) === key ? date : null;
}

/** The start of the local day after `day` — its end, as an instant. */
export function endOfLocalDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
}

/** The local days from `since` to `until`, both included; null where `until` comes before `since` or the span is longer than `max` days. */
export function daysBetween(since: Date, until: Date, max = NOTE_HISTORY_DAYS_MAX): string[] | null {
  const days: string[] = [];
  for (let day = new Date(since.getFullYear(), since.getMonth(), since.getDate()); day <= until; day = endOfLocalDay(day)) {
    days.push(localDay(day));
    if (days.length > max) return null;
  }
  return days.length ? days : null;
}

/** What a note gained on one day, and how many lines it lost. */
export interface DayChange {
  day: string;
  /** The gained lines, cut at {@link NOTE_HISTORY_DAY_CHARS}. */
  shown: string;
  added: number;
  removed: number;
}

/** A text cut to a length at the end of a line; a single line that is longer is cut in the line. */
function cutAtLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = head.lastIndexOf("\n");
  return end > max / 2 ? head.slice(0, end) : head;
}

/**
 * Day by day, what a note gained: each day's text at its end against the
 * text before — the first against `start`, the state at the beginning of the
 * first day. A day on which no line came or went is left out.
 *
 * What is compared is what the note says, without its properties block —
 * as in a folder's log: a changed property (the mood of a day, the app's own
 * settings) is no line of the note.
 */
export function dayChanges(start: string, days: readonly { day: string; text: string }[]): DayChange[] {
  const changes: DayChange[] = [];
  let before = noteBodyOf(start);
  for (const { day, text } of days) {
    const body = noteBodyOf(text);
    if (body !== before) {
      const delta = linesGained(before, body);
      if (delta.added.length > 0 || delta.removed > 0) {
        changes.push({ day, shown: cutAtLine(delta.added.join("\n"), NOTE_HISTORY_DAY_CHARS), added: delta.added.length, removed: delta.removed });
      }
    }
    before = body;
  }
  return changes;
}
