import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import { normalizeJournalPath } from "./deletionJournal.js";
import type { OwnDeletionRegister } from "./ownDeletions.js";
import type { IndexedRowStamp } from "../vault/indexedRowStamp.js";

/**
 * A removal the sync carries out here — a deletion of the provider's, or of
 * the encrypted workspace's, mirrored into the vault — noted in the index
 * database before the file goes and forgotten once it is recorded.
 *
 * The worker also marks it in memory (`OwnDeletionRegister`), so the index's
 * report of the vanished file is not taken for the person's deletion. That
 * mark is gone with the runtime: a close that called the runtime off, or a
 * crash, between the removal and its record left the next runtime to find a
 * missing file nobody had marked — and to queue it as the person's deletion,
 * with an entry in the synced deletion journal and a count towards the
 * mass-deletion question (the class of the incident of 2026-09-20). The next
 * runtime takes the notes over before its index looks (`adoptOwnRemovals`).
 */
const PREFIX = "sync-own-removal:";

interface Note {
  stamps?: number[];
}

/** Notes, before the file goes, that the sync removes `path` here; `stamps` as for `OwnDeletionRegister.mark`. */
export async function noteOwnRemoval(db: SqlStatements, path: string, stamps?: readonly IndexedRowStamp[]): Promise<void> {
  const key = normalizeJournalPath(path);
  if (!key) return;
  const note: Note = stamps ? { stamps: stamps.map((s) => s.mtime) } : {};
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [PREFIX + key, JSON.stringify(note)]);
}

/** The removal is recorded (or did not happen): the note goes. */
export async function forgetOwnRemoval(db: SqlStatements, path: string): Promise<void> {
  const key = normalizeJournalPath(path);
  if (!key) return;
  await db.execute(`DELETE FROM meta WHERE key = ?`, [PREFIX + key]);
}

/**
 * At the start of a runtime, before its index looks at the vault: every
 * removal noted and not recorded is marked in the new register — so the
 * index's report of the vanished file stays the sync's — and recorded the way
 * the worker would have (its sync row goes). Where the file is still there,
 * the removal did not happen: only the note goes, and the next cycle carries
 * the deletion out again. Returns how many were taken over.
 */
export async function adoptOwnRemovals(
  db: SqlStatements,
  register: OwnDeletionRegister,
  stillThere: (path: string) => Promise<boolean>,
): Promise<number> {
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM meta WHERE key LIKE ?`, [`${PREFIX}%`]).catch(() => []);
  let adopted = 0;
  for (const row of rows) {
    if (typeof row?.key !== "string" || !row.key.startsWith(PREFIX)) continue;
    const path = row.key.slice(PREFIX.length);
    let note: Note = {};
    try {
      note = JSON.parse(row.value) as Note;
    } catch {
      // A note that cannot be read still says the sync removed the file.
    }
    if (await stillThere(path).catch(() => true)) {
      await db.execute(`DELETE FROM meta WHERE key = ?`, [row.key]);
      continue;
    }
    // As the worker marks: only for rows the index can report; without one, nothing to answer for.
    if (Array.isArray(note.stamps) && note.stamps.length > 0) register.mark(path, note.stamps.map((mtime) => ({ mtime })));
    await db.execute(`DELETE FROM sync_state WHERE path = ?`, [path]);
    await db.execute(`DELETE FROM meta WHERE key = ?`, [row.key]);
    adopted += 1;
  }
  return adopted;
}
