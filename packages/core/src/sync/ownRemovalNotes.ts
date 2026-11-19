import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import { normalizeJournalPath } from "./deletionJournal.js";
import type { OwnDeletionRegister } from "./ownDeletions.js";
import type { IndexedRowStamp } from "../vault/indexedRowStamp.js";
import { OWN_REMOVAL_NOTE_PREFIX } from "./ownRemovalNoteKey.js";

export { OWN_REMOVAL_NOTE_PREFIX };

/**
 * A removal the sync carries out here — a deletion of the provider's, or of
 * the encrypted workspace's, mirrored into the vault — noted in the index
 * database before the file goes and forgotten once it is recorded.
 *
 * The worker also marks it in memory (`OwnDeletionRegister`), so the index's
 * report of the vanished file is not taken for the person's deletion. That
 * mark is gone with the runtime: a crash, or a close that ended the runtime,
 * between the removal and its record left the next runtime to find a
 * missing file nobody had marked — and to queue it as the person's deletion,
 * with an entry in the synced deletion journal and a count towards the
 * mass-deletion question (the class of the incident of 2026-09-20). The next
 * runtime takes the notes over before its index looks (`adoptOwnRemovals`).
 */
const PREFIX = OWN_REMOVAL_NOTE_PREFIX;

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

/** How the start looks at the vault for `adoptOwnRemovals`. */
export interface OwnRemovalLooks {
  /** The vault's own folder is reachable (`vaultFolderIsThere`): without it, every file looks gone. */
  vaultIsThere: () => Promise<boolean>;
  /** Whether the file is on disk. A look that fails throws: nothing is decided for it. */
  exists: (path: string) => Promise<boolean>;
}

/** Something is queued for `path` — of the plain sync or of the encrypted workspace: the queue owns its future. */
const QUEUED = `SELECT 1 AS n FROM offline_queue WHERE file_path = ? OR new_path = ?
  UNION ALL SELECT 1 AS n FROM workspace_queue WHERE path = ? OR new_path = ? LIMIT 1`;

/**
 * At the start of a runtime, before its index looks at the vault: every
 * removal noted and not recorded is marked in the new register — so the
 * index's report of the vanished file stays the sync's — and recorded the way
 * the worker would have (its sync row goes). Where the file is still there,
 * the removal did not happen: only the note goes, and the next cycle carries
 * the deletion out again.
 *
 * Decided only while the vault's folder is there before and after the looks
 * (as the sweep of what an ended app left owed, `sweepRemovals`): a folder
 * that is away — a picked folder whose grant went, a share that dropped —
 * answers "missing" for every file, and the sync row of a file that may well
 * be there would go. A look that fails decides nothing either. Their notes
 * stay for the next start.
 *
 * A path with something queued is not touched: the queue owns it — a
 * deletion the person made after the note was left (a note of a removal
 * whose record failed), a rename, a write. Its note goes, and nothing else.
 * Returns how many were taken over.
 */
export async function adoptOwnRemovals(db: SqlStatements, register: OwnDeletionRegister, looks: OwnRemovalLooks): Promise<number> {
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM meta WHERE key LIKE ?`, [`${PREFIX}%`]);
  const notes = rows.filter((row) => typeof row?.key === "string" && row.key.startsWith(PREFIX));
  if (notes.length === 0 || !(await looks.vaultIsThere().catch(() => false))) return 0;
  const decided: Array<{ key: string; path: string; note: Note; there: boolean }> = [];
  for (const row of notes) {
    const path = row.key.slice(PREFIX.length);
    let note: Note = {};
    try {
      note = JSON.parse(row.value) as Note;
    } catch {
      // A note that cannot be read still says the sync removed the file.
    }
    // silent: a look that fails decides nothing; the note waits for the next start.
    const there = await looks.exists(path).then((v) => v, () => null);
    if (there !== null) decided.push({ key: row.key, path, note, there });
  }
  // Asked once more after the looks: a folder that went in between proves nothing.
  if (decided.length === 0 || !(await looks.vaultIsThere().catch(() => false))) return 0;
  let adopted = 0;
  for (const { key, path, note, there } of decided) {
    const queued = await db.queryOne<{ n: number }>(QUEUED, [path, path, path, path]);
    if (there || queued) {
      await db.execute(`DELETE FROM meta WHERE key = ?`, [key]);
      continue;
    }
    // As the worker marks: only for rows the index can report; without one, nothing to answer for.
    if (Array.isArray(note.stamps) && note.stamps.length > 0) register.mark(path, note.stamps.map((mtime) => ({ mtime })));
    await db.execute(`DELETE FROM sync_state WHERE path = ?`, [path]);
    await db.execute(`DELETE FROM meta WHERE key = ?`, [key]);
    adopted += 1;
  }
  return adopted;
}
