import type { SourceTimestamps, UnpackedFile } from './ImportTypes.js';

/**
 * Normalizes the timestamp shapes the sources hand us into epoch milliseconds.
 *
 * Every app states its dates differently — Keep in microseconds, Simplenote and
 * Notion as ISO, Evernote as a compact UTC stamp, a file only as its mtime.
 * The importers all end up building the same `SourceTimestamps`, so the writer
 * has exactly one thing to stamp.
 *
 * Every helper returns `undefined` rather than a wrong number: an import that
 * guesses a date is worse than one that admits it has none, because the wrong
 * one silently reorders the user's vault.
 */

/** Epoch ms from an ISO 8601 string (`2019-03-14T09:26:53Z`). */
export function msFromIso(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Epoch ms from microseconds — Google Keep states both of its dates that way. */
export function msFromMicroseconds(value: unknown): number | undefined {
  const usec = typeof value === 'string' ? Number(value) : value;
  if (typeof usec !== 'number' || !Number.isFinite(usec) || usec <= 0) return undefined;
  return Math.round(usec / 1000);
}

/**
 * Epoch ms from an ENEX stamp (`20190314T092653Z`).
 *
 * ENEX writes UTC without separators, which `Date.parse` does not accept — the
 * importer used to keep only the date part and drop the time entirely.
 */
export function msFromEnexStamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return undefined;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Timestamps of a file entry — all a plain file selection can tell us. */
export function timesFromFile(file: Pick<UnpackedFile, 'mtimeMs'>): SourceTimestamps | undefined {
  const modifiedMs = typeof file.mtimeMs === 'number' && Number.isFinite(file.mtimeMs)
    ? file.mtimeMs
    : undefined;
  return modifiedMs === undefined ? undefined : { modifiedMs };
}

/** Drops a pair that carries nothing, so callers can pass it straight through. */
export function timesOrUndefined(times: SourceTimestamps): SourceTimestamps | undefined {
  return times.createdMs === undefined && times.modifiedMs === undefined ? undefined : times;
}
