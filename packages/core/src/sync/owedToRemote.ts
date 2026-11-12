import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import { isTwinSpelling } from "./pathIdentity.js";
import { isInternalPath } from "../vault/internalPath.js";
import { outsideWorkspaceNamespaceSql } from "../workspace/path.js";

/**
 * What the index decided and committed, and the queue never heard of
 * (stability plan R22).
 *
 * The index tells the host what it found — a file that went, one another
 * program changed — once its transaction is through, and the host queues the
 * remote deletion or the upload in a transaction of its own. An app that ends
 * in between leaves the decision in the index and nothing in the queue: the
 * next pass finds the index as the last one left it and has nothing to say.
 *
 * So the index writes down what it decided, in the transaction that decides
 * it, and the first cycle of the next sync queues what is written down:
 *
 *  - a deletion: `index_removed`, one row per file the index removed AND
 *    reports (`VaultIndexer.markRemoved`). Queueing the deletion takes the row
 *    off (`SyncQueue.queueDeletePaths`, the workspace's `enqueue`); this sweep
 *    takes off every row it has dealt with. It rests on that record and on
 *    nothing inferred: a path that merely has a sync row and no index row is
 *    not owed anything — the index never held it (an internal folder, a
 *    sidecar), or the app keeps the sync row on purpose (a held mass
 *    deletion's restore, a mirrored remote deletion, a forgotten vault). A
 *    build without the record (v0.8.7) removes rows unmarked: what it left
 *    owed stays as inert as it always was;
 *  - a change: the row's `local_ahead`, set in the transaction that writes its
 *    new hash (performance plan L4). The plain sync's sweep has queued those
 *    since L4 (`SyncQueue.enqueueLocalOnlyFiles`); the encrypted workspace's
 *    queue never looked at the mark nor took it off. It does now: an entry
 *    that commits the content the row holds takes it off (`consumedMarks` in
 *    workspace/state.ts), and this sweep offers each marked change once.
 *
 * The hosts run the sweep at the first cycle of their sync, through the same
 * handlers the index's callbacks use (a workspace's permission check
 * included). Whether a file is gone is asked of the disk last (`stillGone`),
 * and only while the vault itself is there before and after the looks: a
 * folder that is away answers "missing" for every file in it, and those
 * marks wait for the next start.
 */

/** The table of the index's reported removals (db/Schema.ts). */
export const INDEX_REMOVED_TABLE = "index_removed";

/** A path the sync never carries, or carries only as a device's own. */
function notForTheRemote(path: string): boolean {
  return isInternalPath(path) || path.includes(".CONFLICT") || isTwinSpelling(path) || path === ".pvws" || path.startsWith(".pvws/");
}

/** Something is queued for the path, or for a folder it lies in, or it lies in one queued. */
const QUEUED_PLAIN = `EXISTS (
  SELECT 1 FROM offline_queue q
   WHERE q.file_path = r.path OR q.new_path = r.path
      OR substr(r.path, 1, length(q.file_path) + 1) = q.file_path || '/'
      OR (q.new_path IS NOT NULL AND substr(r.path, 1, length(q.new_path) + 1) = q.new_path || '/'))`;
const queuedWorkspace = (column: string) => `EXISTS (
  SELECT 1 FROM workspace_queue q
   WHERE q.path = ${column} OR q.new_path = ${column}
      OR substr(${column}, 1, length(q.path) + 1) = q.path || '/'
      OR (q.new_path IS NOT NULL AND substr(${column}, 1, length(q.new_path) + 1) = q.new_path || '/'))`;

interface Mark {
  path: string;
  /** The remote still has the file (plain: a sync row with a remote version; workspace: a live object). */
  remote: number;
  /** The index holds the path again. */
  indexed: number;
  /** Something is queued for it. */
  queued: number;
}

async function marks(db: SqlStatements, workspace: boolean): Promise<Mark[]> {
  const remote = workspace
    ? `EXISTS (SELECT 1 FROM workspace_object o WHERE o.path = r.path AND o.deleted = 0 AND o.current_revision_id IS NOT NULL AND o.content_kind <> 'directory')`
    : `EXISTS (SELECT 1 FROM sync_state s WHERE s.path = r.path AND s.remote_etag IS NOT NULL)`;
  return db.query<Mark>(
    `SELECT r.path AS path,
            CASE WHEN ${remote} THEN 1 ELSE 0 END AS remote,
            CASE WHEN EXISTS (SELECT 1 FROM files f WHERE f.path = r.path) THEN 1 ELSE 0 END AS indexed,
            CASE WHEN ${workspace ? queuedWorkspace("r.path") : QUEUED_PLAIN} THEN 1 ELSE 0 END AS queued
       FROM ${INDEX_REMOVED_TABLE} r
      ORDER BY r.path`,
  );
}

async function clearMarks(db: SqlStatements, paths: readonly string[]): Promise<void> {
  for (const path of paths) await db.execute(`DELETE FROM ${INDEX_REMOVED_TABLE} WHERE path = ?`, [path]);
}

/** Encrypted workspace: the marked changes its queue is owed, before anything is asked. */
export async function workspaceChangesOwed(db: SqlStatements): Promise<string[]> {
  const rows = await db.query<{ path: string }>(
    `SELECT f.path FROM files f
       LEFT JOIN workspace_object o ON o.path = f.path AND o.deleted = 0
      WHERE f.sync_state = 'local_ahead'
        AND f.path NOT LIKE '.plainva%' AND f.path NOT LIKE '%.CONFLICT%' AND ${outsideWorkspaceNamespaceSql("f.path")}
        AND NOT ${queuedWorkspace("f.path")}
        AND (o.object_id IS NULL OR o.plaintext_sha256 IS NULL OR f.sha256 IS NULL OR o.plaintext_sha256 <> f.sha256)
      ORDER BY f.path`,
  );
  return rows.map((row) => row.path).filter((path) => !notForTheRemote(path));
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

/**
 * The marked deletions: each is handed to `remove` once, or found settled
 * (queued, indexed again, nothing left on the remote, not for the remote at
 * all, the file back on disk), and its mark goes either way. While the vault's
 * folder is away nothing is decided and every mark waits.
 */
async function sweepRemovals(db: SqlStatements, workspace: boolean, h: OwedSweepHandlers): Promise<number> {
  const all = await marks(db, workspace);
  if (all.length === 0) return 0;
  const settled: string[] = [];
  const candidates: string[] = [];
  for (const mark of all) {
    if (notForTheRemote(mark.path) || Number(mark.indexed) || !Number(mark.remote) || Number(mark.queued)) settled.push(mark.path);
    else candidates.push(mark.path);
  }
  await clearMarks(db, settled);
  if (candidates.length === 0 || !(await h.vaultIsThere())) return 0;
  const gone: string[] = [];
  const back: string[] = [];
  for (const path of candidates) ((await h.stillGone(path).catch(() => false)) ? gone : back).push(path);
  // Asked once more after the looks: a share that dropped in between proves nothing.
  if (!(await h.vaultIsThere())) return 0;
  // A file that is back is the next pass's to judge, not a deletion.
  await clearMarks(db, back);
  let queued = 0;
  for (const path of gone) {
    try {
      await h.remove(path);
      queued += 1;
    } catch (error) {
      // The mark stays: the next start tries again.
      console.error("[owedToRemote] could not queue an owed deletion", error);
      continue;
    }
    // Handled — queued, or refused by a workspace's permission (which keeps
    // the file as a fork once): either way it is not offered again.
    await clearMarks(db, [path]);
  }
  return queued;
}

/** Plain sync: queues the deletions the index marked and an ended app never queued. */
export async function sweepPlainOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  return { deletions: await sweepRemovals(db, false, h), writes: 0 };
}

/**
 * Encrypted workspace: queues the changes and deletions its queue is owed.
 * A change is offered once: where the handler queues nothing (the
 * workspace's policy refused it and kept the file as a fork), its mark goes,
 * so that no later start makes another fork of it.
 */
export async function sweepWorkspaceOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  await clearWorkspaceMarksAlreadyUp(db);
  let writes = 0;
  if (h.write) {
    for (const path of await workspaceChangesOwed(db)) {
      try {
        await h.write(path);
      } catch (error) {
        console.error("[owedToRemote] could not queue an owed change", error);
        continue;
      }
      const entry = await db.queryOne<{ id: number }>(`SELECT id FROM workspace_queue WHERE path = ? OR new_path = ? LIMIT 1`, [path, path]);
      if (entry) writes += 1;
      else await db.execute(`UPDATE files SET sync_state = 'synced' WHERE path = ? AND sync_state = 'local_ahead'`, [path]);
    }
  }
  return { deletions: await sweepRemovals(db, true, h), writes };
}
