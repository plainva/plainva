import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import { isTwinSpelling } from "./pathIdentity.js";
import { outsideWorkspaceNamespaceSql } from "../workspace/path.js";

/**
 * What the index decided and committed, and the queue never heard of
 * (stability plan R22).
 *
 * The index tells the host what it found — a file that went, one another
 * program changed — once its transaction is through, and the host queues the
 * upload or the remote deletion in a transaction of its own. An app that ends
 * in between leaves the decision in the index and nothing in the queue: the
 * next pass finds the index as the last one left it and has nothing to say.
 * For a change another program made, the index marks the row `local_ahead` in
 * the transaction that writes its new hash (performance plan L4), and the
 * plain sync's sweep at its first cycle queues every such row
 * (`SyncQueue.enqueueLocalOnlyFiles`). Two cases had no sweep:
 *
 *  - a deletion. The index removes the file's row and leaves its sync row (the
 *    remote copy still has to be deleted); with the host's entry lost, nothing
 *    ever deleted the copy on the remote and on every other device. Owed is a
 *    path the remote has (a sync row with a remote version — or, in an
 *    encrypted workspace, an object that is not deleted) with no row in the
 *    index, nothing queued for it, and no file on disk;
 *  - in an encrypted workspace, the change: its queue never looked at
 *    `local_ahead` and never took the mark off. Owed is a `local_ahead` row
 *    with nothing queued whose content is not the object's current one.
 *
 * The hosts run these at the first cycle of their sync, through the same
 * handlers the index's callbacks use (a workspace's permission check
 * included). Whether a file is gone is asked of the disk last
 * (`stillGone`), and only while the vault itself is there: a folder that is
 * away answers "missing" for every file in it.
 */

const LOCAL_ONLY_SQL = (column: string) =>
  `${column} NOT LIKE '.plainva%' AND ${column} NOT LIKE '%.CONFLICT%' AND ${outsideWorkspaceNamespaceSql(column)}`;

/** Plain sync: paths whose deletion the remote is owed, before the disk is asked. */
export async function plainDeletionsOwed(db: SqlStatements): Promise<string[]> {
  const rows = await db.query<{ path: string }>(
    `SELECT s.path FROM sync_state s
      WHERE s.remote_etag IS NOT NULL
        AND ${LOCAL_ONLY_SQL("s.path")}
        AND NOT EXISTS (SELECT 1 FROM files f WHERE f.path = s.path)
        AND NOT EXISTS (SELECT 1 FROM files f WHERE substr(f.path, 1, length(s.path) + 1) = s.path || '/')
        AND NOT EXISTS (
          SELECT 1 FROM offline_queue q
           WHERE q.file_path = s.path OR q.new_path = s.path
              OR substr(s.path, 1, length(q.file_path) + 1) = q.file_path || '/'
              OR (q.new_path IS NOT NULL AND substr(s.path, 1, length(q.new_path) + 1) = q.new_path || '/'))
      ORDER BY s.path`,
  );
  return rows.map((row) => row.path).filter((path) => !isTwinSpelling(path));
}

/** Encrypted workspace: changes and deletions its queue is owed, before the disk is asked. */
export async function workspaceChangesOwed(db: SqlStatements): Promise<{ writes: string[]; deletions: string[] }> {
  const queued = (column: string) => `NOT EXISTS (
    SELECT 1 FROM workspace_queue q
     WHERE q.path = ${column} OR q.new_path = ${column}
        OR substr(${column}, 1, length(q.path) + 1) = q.path || '/'
        OR (q.new_path IS NOT NULL AND substr(${column}, 1, length(q.new_path) + 1) = q.new_path || '/'))`;
  const writes = await db.query<{ path: string }>(
    `SELECT f.path FROM files f
       LEFT JOIN workspace_object o ON o.path = f.path AND o.deleted = 0
      WHERE f.sync_state = 'local_ahead'
        AND ${LOCAL_ONLY_SQL("f.path")}
        AND ${queued("f.path")}
        AND (o.object_id IS NULL OR o.plaintext_sha256 IS NULL OR f.sha256 IS NULL OR o.plaintext_sha256 <> f.sha256)
      ORDER BY f.path`,
  );
  const deletions = await db.query<{ path: string }>(
    `SELECT o.path FROM workspace_object o
      WHERE o.deleted = 0 AND o.current_revision_id IS NOT NULL AND o.content_kind <> 'directory'
        AND ${LOCAL_ONLY_SQL("o.path")}
        AND NOT EXISTS (SELECT 1 FROM files f WHERE f.path = o.path)
        AND ${queued("o.path")}
      ORDER BY o.path`,
  );
  return { writes: writes.map((row) => row.path), deletions: deletions.map((row) => row.path) };
}

/**
 * The `local_ahead` rows of an encrypted workspace whose content IS the
 * object's current one: nothing is owed for them, and the mark goes (an index
 * that marked them before the queue took marks off, R22).
 */
export async function clearWorkspaceMarksAlreadyUp(db: SqlStatements): Promise<void> {
  await db.execute(
    `UPDATE files SET sync_state = 'synced'
      WHERE sync_state = 'local_ahead'
        AND EXISTS (SELECT 1 FROM workspace_object o WHERE o.path = files.path AND o.deleted = 0
                     AND o.plaintext_sha256 IS NOT NULL AND o.plaintext_sha256 = files.sha256)
        AND NOT EXISTS (SELECT 1 FROM workspace_queue q WHERE q.path = files.path OR q.new_path = files.path)`,
  );
}

export interface OwedSweepHandlers {
  /** The vault's own folder is reachable: without it, every file looks gone. */
  vaultIsThere: () => Promise<boolean>;
  /** The file is not on disk. A look that fails answers false. */
  stillGone: (path: string) => Promise<boolean>;
  /** Queues the deletion the way the index's `onLocalFileDeleted` does. */
  remove: (path: string) => Promise<void>;
  /** Queues the change the way the index's `onExternalModification` does (workspace only). */
  write?: (path: string) => Promise<void>;
}

/** What a sweep queued, for the diagnostics. Counts only. */
export interface OwedSweepReport {
  deletions: number;
  writes: number;
}

async function goneOnes(paths: readonly string[], h: OwedSweepHandlers): Promise<string[]> {
  if (paths.length === 0 || !(await h.vaultIsThere())) return [];
  const gone: string[] = [];
  for (const path of paths) if (await h.stillGone(path).catch(() => false)) gone.push(path);
  // Asked once more after the looks: a share that dropped in between proves nothing.
  return (await h.vaultIsThere()) ? gone : [];
}

/** Plain sync: queues the deletions the remote is owed. */
export async function sweepPlainOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  const gone = await goneOnes(await plainDeletionsOwed(db), h);
  for (const path of gone) await h.remove(path);
  return { deletions: gone.length, writes: 0 };
}

/** Encrypted workspace: queues the changes and deletions its queue is owed. */
export async function sweepWorkspaceOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  await clearWorkspaceMarksAlreadyUp(db);
  const owed = await workspaceChangesOwed(db);
  for (const path of owed.writes) await h.write?.(path);
  const gone = await goneOnes(owed.deletions, h);
  for (const path of gone) await h.remove(path);
  return { deletions: gone.length, writes: h.write ? owed.writes.length : 0 };
}
