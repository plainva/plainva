import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";

/**
 * Starter files a vault keeps on this device because it was bound to a cloud
 * folder that already held notes (review 2026-10-27; `starterFilesToHoldBack`
 * in the ui decides which). Stored next to the sync state, one row per path
 * with the hash of the bytes held back: while a file still has them, no
 * upload takes it; the moment the person changes, moves or deletes it, the
 * row goes and the file syncs like any other. A sync to another folder starts
 * without them (`SyncStateRepository.clearAll`), and decides again.
 */
export const HELD_BACK_KEY_PREFIX = "sync-held-back:v1:";

export async function listHeldBackStarters(db: IDatabaseAdapter): Promise<Map<string, string>> {
  const rows = await db.query<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE ?", [HELD_BACK_KEY_PREFIX + "%"]);
  return new Map(rows.map((row) => [row.key.slice(HELD_BACK_KEY_PREFIX.length), row.value]));
}

export async function holdBackStarters(db: IDatabaseAdapter, files: ReadonlyMap<string, string>): Promise<void> {
  for (const [path, hash] of files) {
    await db.execute(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [HELD_BACK_KEY_PREFIX + path, hash],
    );
  }
}

export async function releaseHeldBackStarter(db: IDatabaseAdapter, path: string): Promise<void> {
  await db.execute("DELETE FROM meta WHERE key = ?", [HELD_BACK_KEY_PREFIX + path]);
}

export async function clearHeldBackStarters(db: IDatabaseAdapter): Promise<void> {
  await db.execute("DELETE FROM meta WHERE key LIKE ?", [HELD_BACK_KEY_PREFIX + "%"]);
}
