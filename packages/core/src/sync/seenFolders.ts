import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";

/**
 * Folders this device has seen both here and on the remote (Fehlerliste
 * 0.9.0 A2). Folders have no sync row: the index sees files, so an empty
 * folder deleted outside Plainva queued nothing, and the next full listing —
 * which reports every remote folder so that an empty one appears on a new
 * device — created it here again.
 *
 * With this record the worker can tell the two apart: a listed folder that
 * is missing here and was seen here before was deleted here, and its deletion
 * goes up; one never seen here is new on the remote and is created. Stored in
 * `meta`, one row per folder, next to the sync state; a sync to another
 * folder starts without them (`SyncStateRepository.clearAll`). An older build
 * neither reads nor writes these rows; one that runs on the same index
 * recreates such a folder, as it always did.
 */
export const SEEN_FOLDER_KEY_PREFIX = "sync-seen-folder:v1:";

const prefixMatch = `substr(key, 1, ${SEEN_FOLDER_KEY_PREFIX.length}) = ?`;

export async function listSeenFolders(db: IDatabaseAdapter): Promise<Set<string>> {
  const rows = await db.query<{ key: string }>(`SELECT key FROM meta WHERE ${prefixMatch}`, [SEEN_FOLDER_KEY_PREFIX]);
  return new Set(rows.map((row) => row.key.slice(SEEN_FOLDER_KEY_PREFIX.length)));
}

export async function rememberSeenFolders(db: IDatabaseAdapter, folders: ReadonlyArray<string>): Promise<void> {
  for (const folder of folders) {
    await db.execute("INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING", [SEEN_FOLDER_KEY_PREFIX + folder]);
  }
}

export async function forgetSeenFolders(db: IDatabaseAdapter, folders: ReadonlyArray<string>): Promise<void> {
  for (const folder of folders) await db.execute("DELETE FROM meta WHERE key = ?", [SEEN_FOLDER_KEY_PREFIX + folder]);
}

export async function clearSeenFolders(db: IDatabaseAdapter): Promise<void> {
  await db.execute(`DELETE FROM meta WHERE ${prefixMatch}`, [SEEN_FOLDER_KEY_PREFIX]);
}
