import { parseDailyNoteDate } from "../lib/dailyNotePath";
import { calendarDay } from "../lib/today";

/**
 * `file.day` — the day a daily note's FILE NAME stands for (plan
 * Journal-Erweiterungen, X8/E7).
 *
 * A calendar of a database can only place a row it has a date for, and a daily
 * note's date is its name: `2026-09-22.md`, or `26.09.22.md`, or whatever the
 * vault's format says. Writing that date into the frontmatter as well would be
 * the same fact twice, and the second copy would be the one that goes stale.
 *
 * Virtual and read-only. It is computed from the name when a row is built, it
 * is never stored, and it only ever appears in a `.base` file as the name of a
 * view's date field — never in a note. Obsidian does not know it, so a view
 * that uses it shows nothing there; that is the price of not duplicating the
 * date, and it is written down in the handbook.
 */

export const FILE_DAY = "file.day";

export interface DailyNoteNaming {
  /** Vault-relative folder of the daily notes, "" for the root. */
  folder: string;
  /** Moment-style file-name format, e.g. `YYYY-MM-DD`. */
  format: string;
}

/**
 * Builds the resolver `queryDatabaseFiles` fills `file.day` with — or `null`
 * when the vault has no usable naming, in which case no row carries the field
 * and the picker does not offer it.
 *
 * Injected rather than imported by the core: the format is Moment-style, its
 * translation needs date-fns, and `@plainva/core` is a published package whose
 * dependency list is curated on purpose. The rule itself stays the ONE rule —
 * `parseDailyNoteDate`, the same one that highlights the open daily note.
 */
export function dailyDayResolver(naming: DailyNoteNaming | null | undefined): ((path: string) => string | null) | null {
  const format = naming?.format?.trim();
  if (!format) return null;
  const folder = (naming?.folder ?? "").trim();
  return (path: string) => {
    const date = parseDailyNoteDate(path, format, folder);
    return date ? calendarDay(date) : null;
  };
}

/**
 * Keeps a query service's daily-note naming in step with the vault's settings,
 * in both shells: `follow(naming)` hands the resolver on (`apply`) and answers
 * whether the naming CHANGED since the call before. The first call only sets
 * it. A changed folder or format changes which notes are daily notes — the
 * journal stamp of their tasks, `file.day` of their rows —, so the shell then
 * reloads what it lists; before, open task lists kept the old naming until
 * the next reload (the desktop) or the next opening of the vault (the phone).
 */
export function followDailyNaming(apply: (resolver: ((path: string) => string | null) | null) => void): (naming: DailyNoteNaming) => boolean {
  let last: string | null = null;
  return (naming) => {
    const key = `${(naming.folder ?? "").trim()}\n${(naming.format ?? "").trim()}`;
    if (key === last) return false;
    const first = last === null;
    last = key;
    apply(dailyDayResolver(naming));
    return !first;
  };
}

/**
 * Which column a calendar or timeline places its rows by: the field the view
 * names, else the first column explicitly typed as a date.
 *
 * One rule for both shells (X8). The phone carried its own copy, which is why
 * `file.day` had to be taught to two places — and would have been taught to
 * only one of them.
 */
export function baseDateProperty(
  view: { dateField?: unknown } | undefined,
  columns: Record<string, { input?: string }> | undefined,
): string | null {
  const named = typeof view?.dateField === "string" ? view.dateField.trim() : "";
  if (named) return named;
  if (!columns) return null;
  const typed = Object.entries(columns).find(([, spec]) => spec?.input === "date" || spec?.input === "datetime");
  return typed ? typed[0] : null;
}

/** True for a column whose value is computed and cannot be written back. */
export function isReadOnlyDateColumn(col: string | null | undefined): boolean {
  return col === FILE_DAY;
}
