import type { IDatabaseAdapter } from "./db/IDatabaseAdapter.js";

/**
 * A suggestion copy that was not sent (C34, 2026-09-04).
 *
 * The suggestion mode types into a COPY of a note. Until now that copy lived
 * only in the session's memory: leaving the note kept it (F5), but closing the
 * app, switching the vault or a restart threw it away without a word. It now
 * lives in the vault's own index database — never in the note, never in the
 * sync — keyed by the note's path, together with the base it was typed
 * against and the sentence for the round.
 *
 * The base is stored whole rather than as a hash: reconciling the copy with a
 * note that changed in the meantime needs the base's text to re-find every
 * changed block (see `reconcileParkedSuggestion` in the UI package).
 */
export interface ParkedSuggestion {
  path: string;
  /** The note's text when the mode started - what the copy is a diff against. */
  base: string;
  copy: string;
  note: string;
  /** ISO time of the last write. */
  savedAt: string;
}

const KEY_PREFIX = "suggestion-park:";

/**
 * A copy that proposes nothing (finding 2026-09-19: "0 blocks … found").
 *
 * The mode reports its block count the moment it starts, and that report is
 * what schedules the park — so a copy identical to its base, with no sentence
 * for the round, was written and then OFFERED on the next open. The same
 * happened on the desktop whenever a change was taken back. There is nothing
 * in such a copy to come back to: it is never stored and never offered, and
 * both shells get that from here rather than each from its own guard.
 */
export function isEmptyParkedSuggestion(record: Pick<ParkedSuggestion, "base" | "copy" | "note">): boolean {
  return record.copy === record.base && record.note.trim() === "";
}

export function parkedSuggestionKey(path: string): string {
  return `${KEY_PREFIX}${path}`;
}

export async function readParkedSuggestion(db: IDatabaseAdapter, path: string): Promise<ParkedSuggestion | null> {
  const row = await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [parkedSuggestionKey(path)]);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<ParkedSuggestion>;
    if (typeof parsed.base !== "string" || typeof parsed.copy !== "string") return null;
    const record: ParkedSuggestion = {
      path,
      base: parsed.base,
      copy: parsed.copy,
      note: typeof parsed.note === "string" ? parsed.note : "",
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
    if (isEmptyParkedSuggestion(record)) {
      // A row from before the rule existed. Tidied on the way out; a reader
      // that may not write (an auxiliary window) simply leaves it, and the
      // owner's next read removes it.
      await clearParkedSuggestion(db, path).catch(() => {});
      return null;
    }
    return record;
  } catch {
    // A damaged row is not a crash on opening a note; it is simply no copy.
    return null;
  }
}

export async function writeParkedSuggestion(db: IDatabaseAdapter, record: ParkedSuggestion): Promise<void> {
  // Nothing proposed: the row goes rather than being written (see above) - so
  // a change that was taken back also takes its parked copy with it.
  if (isEmptyParkedSuggestion(record)) return clearParkedSuggestion(db, record.path);
  const value = JSON.stringify({ base: record.base, copy: record.copy, note: record.note, savedAt: record.savedAt });
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [parkedSuggestionKey(record.path), value]);
}

export async function clearParkedSuggestion(db: IDatabaseAdapter, path: string): Promise<void> {
  await db.execute(`DELETE FROM meta WHERE key = ?`, [parkedSuggestionKey(path)]);
}

/** Paths that hold a parked copy - for a note that was renamed or deleted. */
export async function listParkedSuggestionPaths(db: IDatabaseAdapter): Promise<string[]> {
  const rows = await db.query<{ key: string }>(`SELECT key FROM meta WHERE key LIKE ?`, [`${KEY_PREFIX}%`]);
  return rows.map((row) => row.key.slice(KEY_PREFIX.length));
}
