/**
 * The journal as one stream over all days (plan Journal, J5) — the pure model
 * both views draw from.
 *
 * Entries live in the daily notes; nothing here is stored a second time. A day
 * is read from its note when the stream reaches it, and ONLY then: the stream
 * loads in windows (the newest days that have entries; "load older" continues
 * where the last window stopped), because the project has no list
 * virtualisation and a year of daily notes read at once would be too much for a
 * phone. When a note changes, only its day is read again.
 */
import { parseJournal, readFrontmatterPath, type JournalEntry } from "@plainva/core";
import { localIsoKey, parseDailyNoteDate } from "./dailyNotePath";

export interface JournalFeedSettings {
  /** Daily-notes folder and file-name format — what makes a note a daily note. */
  folder: string;
  format: string;
  /** The journal heading of the vault. */
  heading: string;
  /**
   * The frontmatter property a day is rated in (plan Journal-Erweiterungen,
   * X6). Empty = the vault rates no days, and the head shows no marks.
   */
  moodProperty?: string;
}

export interface JournalDay {
  /** Local day key `YYYY-MM-DD`. */
  key: string;
  date: Date;
  path: string;
  /** In file order — the note reads chronologically; the view shows the newest on top. */
  entries: JournalEntry[];
  /**
   * How the day was rated, read from the frontmatter property the vault names
   * as its mood (plan Journal-Erweiterungen, X6). `null` when the note has no
   * value; `undefined` when the vault names no property at all — the day head
   * then shows nothing rather than an empty row of marks.
   */
  mood?: number | null;
}

export interface JournalFilter {
  /** Case-insensitive; every word has to occur somewhere in the entry. */
  text: string;
  /** A tag without `#`; an entry tagged `client/acme` matches `client`. */
  tag: string | null;
  tasksOnly: boolean;
}

export const NO_JOURNAL_FILTER: JournalFilter = { text: "", tag: null, tasksOnly: false };
export const isJournalFiltered = (filter: JournalFilter): boolean => filter.text.trim() !== "" || filter.tag !== null || filter.tasksOnly;

/** Days with entries a window is filled up to, and the notes it reads at most to get there. */
export const JOURNAL_WINDOW_DAYS = 14;
export const JOURNAL_WINDOW_READS = 60;

export interface JournalCandidate { path: string; date: Date; key: string }

/** The daily notes among `paths`, newest day first. */
export function journalCandidates(paths: readonly string[], settings: Pick<JournalFeedSettings, "folder" | "format">): JournalCandidate[] {
  const found: JournalCandidate[] = [];
  for (const path of paths) {
    const date = parseDailyNoteDate(path, settings.format, settings.folder);
    if (date) found.push({ path, date, key: localIsoKey(date) });
  }
  return found.sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path));
}

const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();

export function entryMatches(entry: JournalEntry, filter: JournalFilter): boolean {
  if (filter.tasksOnly && entry.task === null) return false;
  if (filter.tag !== null) {
    const wanted = filter.tag.toLowerCase();
    if (!entry.tags.some((tag) => tag.toLowerCase() === wanted || tag.toLowerCase().startsWith(`${wanted}/`))) return false;
  }
  const words = fold(filter.text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${entry.time} ${entry.text}`);
  return words.every((word) => hay.includes(word));
}

/** One day from the text of its note; `null` when it has no entry (that passes the filter). */
export function journalDayOf(candidate: JournalCandidate, raw: string, heading: string, filter: JournalFilter = NO_JOURNAL_FILTER, moodKey = ""): JournalDay | null {
  const entries = parseJournal(raw, { heading }).entries.filter((entry) => entryMatches(entry, filter));
  if (!entries.length) return null;
  const day: JournalDay = { key: candidate.key, date: candidate.date, path: candidate.path, entries };
  // The note has been read already; the mood is one lookup in what is here.
  if (moodKey.trim()) {
    const value = readFrontmatterPath(raw, [moodKey.trim()]);
    day.mood = typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return day;
}

export interface JournalWindow {
  days: JournalDay[];
  /**
   * The day the stream has been read THROUGH (a timestamp): every daily note
   * of that day or later has been looked at. A date rather than an index, so a
   * daily note that appears later — created on another device, synced in —
   * cannot shift the place where "load older" continues.
   */
  through: number | null;
  /** Whether older daily notes are left — "load older" has something to do. */
  more: boolean;
}

/**
 * Reads the next window: the candidates older than `before` (`null` = from the
 * newest), until `JOURNAL_WINDOW_DAYS` days with entries are found or
 * `JOURNAL_WINDOW_READS` notes were read. A note that cannot be read is skipped
 * — one broken file must not end the stream.
 */
export async function loadJournalWindow(
  candidates: readonly JournalCandidate[],
  before: number | null,
  read: (path: string) => Promise<string>,
  heading: string,
  filter: JournalFilter = NO_JOURNAL_FILTER,
  moodKey = "",
): Promise<JournalWindow> {
  const pool = before === null ? candidates : candidates.filter((c) => c.date.getTime() < before);
  const days: JournalDay[] = [];
  let at = 0;
  while (at < pool.length && days.length < JOURNAL_WINDOW_DAYS && at < JOURNAL_WINDOW_READS) {
    const candidate = pool[at++];
    let raw: string;
    try {
      raw = await read(candidate.path);
    } catch {
      continue;
    }
    const day = journalDayOf(candidate, raw, heading, filter, moodKey);
    if (day) days.push(day);
  }
  return { days, through: at > 0 ? pool[at - 1].date.getTime() : before, more: at < pool.length };
}

/** The stream after one note changed: that day read again, put in its place, or taken out. */
export function withJournalDay(days: readonly JournalDay[], candidate: JournalCandidate, day: JournalDay | null): JournalDay[] {
  const rest = days.filter((d) => d.path !== candidate.path);
  if (!day) return rest;
  return [...rest, day].sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path));
}

/** The tags of the loaded days by how often they occur — the filter chips. */
export function journalTags(days: readonly JournalDay[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const day of days) for (const entry of day.entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag);
}

/** Entries of a day as the view shows them: the newest on top. */
export const newestFirst = (entries: readonly JournalEntry[]): JournalEntry[] => [...entries].sort((a, b) => b.seconds - a.seconds || b.line - a.line);

/** `14:05` → the clock of the app's language (`2:05 PM`); seconds are shown only when the entry carries them. */
export function formatJournalTime(entry: Pick<JournalEntry, "time" | "seconds">, language: string): string {
  const withSeconds = entry.time.split(":").length === 3;
  const at = new Date(2000, 0, 1, Math.floor(entry.seconds / 3600), Math.floor(entry.seconds / 60) % 60, entry.seconds % 60);
  return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) }).format(at);
}
