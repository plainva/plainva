/**
 * The names of conflict copies (P3.11): `<base>.CONFLICT-<iso-stamp><ext>`, the
 * grammar of SyncWorker.preserveLocalAsConflict — read back to the original,
 * to the moment, and to a label a person reads. No vault access here: the
 * end-to-end specs import this module as it is.
 */
import { formatDateAndTime, type TimeFormatOptions } from "./timeFormat";

/** `Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md` -> `Notes/a.md`; null if not a conflict copy. */
export function conflictOriginalPath(conflictPath: string): string | null {
  const marker = conflictPath.lastIndexOf(".CONFLICT-");
  if (marker < 0 || marker < Math.max(conflictPath.lastIndexOf("/"), conflictPath.lastIndexOf("\\"))) return null;
  const suffix = conflictPath.slice(marker + ".CONFLICT-".length);
  const dot = suffix.lastIndexOf(".");
  return conflictPath.slice(0, marker) + (dot >= 0 && dot < suffix.length - 1 ? suffix.slice(dot) : "");
}

/**
 * When a conflict copy was made, read from its name
 * (`….CONFLICT-2026-07-05T12-30-00-000Z.md`, an editor's copy with a random
 * `-1a2b3c4d` after the stamp); null for a name that carries no stamp.
 */
export function conflictCopyTime(conflictPath: string): Date | null {
  const marker = conflictPath.lastIndexOf(".CONFLICT-");
  if (marker < 0 || conflictOriginalPath(conflictPath) === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(conflictPath.slice(marker + ".CONFLICT-".length));
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number);
  const at = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!, ms!));
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A conflict copy as a person reads it: the note's name and when the copy was
 * made — "Notiz 1 · 2 Aug 2026, 11:05:12" — instead of the raw file name
 * `Notiz 1.CONFLICT-2026-08-02T09-05-12-345Z.md` the notices used to print
 * (finding X10, review 2026-11-10). A path that is no conflict copy comes back
 * unchanged.
 */
export function conflictCopyLabel(conflictPath: string, language: string, options: Pick<TimeFormatOptions, "hourCycle" | "timeZone"> = {}): string {
  const original = conflictOriginalPath(conflictPath);
  if (!original) return conflictPath;
  const name = (original.split(/[\\/]/).pop() ?? original).replace(/\.md$/i, "");
  const at = conflictCopyTime(conflictPath);
  if (!at) return name;
  // With seconds: two copies of one note made in the same minute (a save and a
  // keep, two windows) must not read alike. The file name stays reachable from
  // the notice itself (desktop: its tooltip; phone: the line under it).
  return `${name} · ${formatDateAndTime(at, { language, ...options, seconds: true })}`;
}
