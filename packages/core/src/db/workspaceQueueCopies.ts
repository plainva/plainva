import type { IDatabaseAdapter } from "./IDatabaseAdapter.js";

/**
 * Version 1: entries of the encrypted workspace's queue that an older version
 * queued twice are one again (Datensicherheit D2).
 *
 * `SqlWorkspaceStateStore.enqueue` used to insert whatever it was given. An
 * entry written again after a failure — the insert had landed, its answer had
 * not — stood in the queue twice; the second copy of a rename made the worker
 * create a second object at the destination. Now the store takes the same
 * entry twice as one; this removes the copies that are there already.
 *
 * A copy is a row whose fields are those of an older row — operation, path,
 * the rename's target —, neither prepared, with no row between the two that
 * touches its paths. The oldest stays. A row that repeats an older one after
 * something else touched its paths (a write, a deletion, a write again) is no
 * copy: the worker pushes them in order, and a queued deletion is pushed even
 * where the file has come back. That is also why there is no unique index: it
 * would refuse exactly those repeats.
 *
 * One statement: an interrupted run removed nothing or everything, and a run
 * over a queue without copies removes nothing. The version is written after it.
 */
export const WORKSPACE_QUEUE_COPIES_VERSION = 1;

async function readVersion(db: IDatabaseAdapter): Promise<number> {
  try {
    const row = await db.queryOne<{ value?: string; VALUE?: string }>(`SELECT value FROM meta WHERE key = 'workspace_queue_copies_version'`);
    const raw = row ? (row.value ?? row.VALUE) : undefined;
    return raw != null ? parseInt(String(raw), 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/** A row of the queue `x` touches the path in `column` of row `r`: the same, a folder of it, or below it. */
const touches = (x: string, r: string) => `(
  ${x}.path = ${r} OR ${x}.new_path = ${r}
  OR substr(${r}, 1, length(${x}.path) + 1) = ${x}.path || '/'
  OR substr(${x}.path, 1, length(${r}) + 1) = ${r} || '/'
  OR substr(${r}, 1, length(${x}.new_path) + 1) = ${x}.new_path || '/'
  OR substr(${x}.new_path, 1, length(${r}) + 1) = ${r} || '/'
)`;

/** Removes the copies described above, once per database; returns how many, or null when this database has been through it. */
export async function mergeWorkspaceQueueCopies(db: IDatabaseAdapter): Promise<number | null> {
  if ((await readVersion(db)) >= WORKSPACE_QUEUE_COPIES_VERSION) return null;
  const copies = `
    FROM workspace_queue copy
   WHERE copy.prepared_json IS NULL
     AND EXISTS (
       SELECT 1 FROM workspace_queue first
        WHERE first.id < copy.id
          AND first.operation = copy.operation AND first.path = copy.path AND first.new_path IS copy.new_path
          AND first.prepared_json IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM workspace_queue between_
             WHERE between_.id > first.id AND between_.id < copy.id
               AND (${touches("between_", "copy.path")} OR (copy.new_path IS NOT NULL AND ${touches("between_", "copy.new_path")}))
          )
     )`;
  const count = await db.queryOne<{ n?: number; N?: number }>(`SELECT COUNT(*) AS n ${copies}`);
  const merged = Number(count?.n ?? count?.N ?? 0);
  if (merged > 0) await db.execute(`DELETE FROM workspace_queue WHERE id IN (SELECT copy.id ${copies})`);
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('workspace_queue_copies_version', ?)`, [String(WORKSPACE_QUEUE_COPIES_VERSION)]);
  if (merged > 0) console.warn(`[Schema] ${merged} copied entr${merged === 1 ? "y" : "ies"} of the encrypted workspace's queue merged into the one before`);
  return merged;
}
