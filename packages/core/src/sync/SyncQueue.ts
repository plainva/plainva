import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { SyncOperation } from "./ISyncTarget.js";

/**
 * Manages the offline queue and basic synchronization state.
 */
export class SyncQueue {
  constructor(
    private readonly db: IDatabaseAdapter
  ) {}

  /**
   * Queues a write operation.
   * This is called AFTER the file was written locally.
   */
  async queueWrite(path: string): Promise<void> {
    await this.db.transaction(async () => {
      // Coalesce: a newer write supersedes earlier still-pending writes of the same
      // file, so the queue does not grow unbounded with redundant full-content rows
      // during local editing. Skip coalescing when a structural op (rename/delete)
      // for the same file is already queued, since then the relative order of
      // operations must be preserved.
      const structural = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM offline_queue
         WHERE file_path = ? AND operation IN ('rename', 'delete')
         LIMIT 1`,
        [path]
      );
      if (!structural) {
        await this.db.execute(
          `DELETE FROM offline_queue
           WHERE file_path = ? AND operation = 'write'
             AND COALESCE(requires_manual_intervention, 0) = 0`,
          [path]
        );
      }

      // Add to offline_queue
      await this.db.execute(
        `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, ?, ?)`,
        [path, "write", Date.now()]
      );

      // Update sync_state in files table
      await this.db.execute(
        `UPDATE files SET sync_state = 'local_ahead' WHERE path = ?`,
        [path]
      );
    });
  }

  /**
   * Queues a delete operation. Idempotent: an in-app folder deletion enqueues
   * the folder AND each contained file explicitly (QueueingVaultAdapter), while
   * the follow-up full-scan reports the same children via onLocalFileDeleted —
   * a second pending delete row for the same path would only inflate the
   * mass-deletion guard's count and produce redundant remote calls.
   */
  async queueDelete(path: string): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM offline_queue WHERE file_path = ? AND operation = 'delete' LIMIT 1`,
        [path]
      );
      if (existing) return;

      await this.db.execute(
        `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, ?, ?)`,
        [path, "delete", Date.now()]
      );

      await this.db.execute(
        `UPDATE files SET sync_state = 'local_ahead', is_deleted = 1 WHERE path = ?`,
        [path]
      );
    });
  }

  /**
   * Queues a folder creation (2026-07-17, empty-folder sync): the folder is
   * pushed to the remote via ISyncTarget.createFolder so it appears in the
   * cloud immediately instead of materializing with its first file. Idempotent
   * like queueDelete — folder creates are cheap no-ops when repeated, and the
   * remote createFolder implementations treat "already exists" as success.
   */
  async queueMkdir(path: string): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM offline_queue WHERE file_path = ? AND operation = 'mkdir' LIMIT 1`,
        [path]
      );
      if (existing) return;
      await this.db.execute(
        `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, ?, ?)`,
        [path, "mkdir", Date.now()]
      );
    });
  }

  async queueRename(oldPath: string, newPath: string): Promise<void> {
    await this.db.transaction(async () => {
      const oldPrefix = oldPath + "/";
      const newPrefix = newPath + "/";
      const oldLen = oldPath.length;

      // 1. Update pending operations in offline_queue (so they point to the new paths)
      // This ensures that pending writes/deletes for children of a renamed folder are not lost.
      const ops = await this.db.query<{id: number, file_path: string, new_path: string | null}>(
        `SELECT id, file_path, new_path FROM offline_queue`
      );
      for (const op of ops) {
         let changed = false;
         let fp = op.file_path;
         let np = op.new_path;
         
         if (fp === oldPath) { fp = newPath; changed = true; }
         else if (fp.startsWith(oldPrefix)) { fp = newPrefix + fp.substring(oldPrefix.length); changed = true; }

         if (np === oldPath) { np = newPath; changed = true; }
         else if (np && np.startsWith(oldPrefix)) { np = newPrefix + np.substring(oldPrefix.length); changed = true; }

         if (changed) {
           await this.db.execute(`UPDATE offline_queue SET file_path = ?, new_path = ? WHERE id = ?`, [fp, np, op.id]);
         }
      }

      // 2. Insert the rename operation itself
      await this.db.execute(
        `INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES (?, ?, ?, ?)`,
        [oldPath, "rename", newPath, Date.now()]
      );

      // 3. Update files table: exact match AND all children (if it was a folder)
      // Setting mtime_local = 0 forces the indexer to re-read the file to update title/FTS properly.
      const files = await this.db.query<{path: string}>(
        `SELECT path FROM files WHERE path = ? OR path LIKE ?`,
        [oldPath, oldPrefix + '%']
      );

      for (const f of files) {
        const p = f.path;
        let updatedPath = newPath;
        if (p !== oldPath) {
          updatedPath = newPath + p.substring(oldLen);
        }
        await this.db.execute(
          `UPDATE files SET path = ?, sync_state = 'local_ahead', mtime_local = 0 WHERE path = ?`,
          [updatedPath, p]
        );
      }
    });
  }

  /**
   * Enqueues write operations for all local files that aren't already queued.
   */
  async enqueueAllLocalFiles(): Promise<void> {
    await this.db.transaction(async () => {
      const files = await this.db.query<{ path: string }>('SELECT path FROM files WHERE path NOT LIKE \'.plainva%\'');
      for (const row of files) {
        // Only enqueue if not already queued
        const existing = await this.db.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? LIMIT 1`,
          [row.path]
        );
        if (!existing) {
          await this.db.execute(
            `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, ?, ?)`,
            [row.path, "write", Date.now()]
          );
          await this.db.execute(
            `UPDATE files SET sync_state = 'local_ahead' WHERE path = ?`,
            [row.path]
          );
        }
      }
    });
  }

  /**
   * Whether the given path currently has any queued operation (matched as either the
   * source path or a rename target).
   */
  async hasPendingOperation(path: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: number }>(
      `SELECT id FROM offline_queue WHERE file_path = ? OR new_path = ? LIMIT 1`,
      [path, path]
    );
    return !!row;
  }

  /**
   * Whether the path has a queued DELETE or RENAME (a *structural* op), as opposed to a
   * plain write. The sync worker must still short-circuit reconcile for a pending
   * delete/rename — re-downloading and rewriting a file the user is deleting or renaming
   * would resurrect it. A pending WRITE deliberately does NOT short-circuit reconcile: a
   * concurrent remote change must be merged/preserved, not silently clobbered by the
   * queued local push (data loss). See SyncWorker.runCycle.
   */
  async hasPendingStructuralOp(path: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: number }>(
      `SELECT id FROM offline_queue
       WHERE (file_path = ? OR new_path = ?) AND operation IN ('rename', 'delete')
       LIMIT 1`,
      [path, path]
    );
    return !!row;
  }

  /** Paths of all queued DELETE operations (regardless of backoff/manual-intervention state). */
  async getPendingDeletePaths(): Promise<string[]> {
    const rows = await this.db.query<{ file_path: string }>(
      `SELECT file_path FROM offline_queue WHERE operation = 'delete'`
    );
    return rows.map((r) => r.file_path);
  }

  /**
   * Paths with a queued DELETE or RENAME (P3.3): the pull's download
   * prefetcher must not even START a speculative download for a file the user
   * is deleting/renaming — reconcile skips them anyway (no resurrection).
   */
  async getPendingStructuralPaths(): Promise<string[]> {
    const rows = await this.db.query<{ file_path: string }>(
      `SELECT file_path FROM offline_queue WHERE operation IN ('delete', 'rename')`
    );
    return rows.map((r) => r.file_path);
  }

  /**
   * Read-only queue snapshot for the UI (P3.4 "queue visibility"): total
   * count plus the oldest `limit` operations — including backed-off and
   * manual-intervention entries, which is exactly what a user debugging a
   * stuck sync needs to see.
   */
  async listAllPending(
    limit: number
  ): Promise<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> }> {
    const totalRow = await this.db.query<{ n: number }>(`SELECT COUNT(*) as n FROM offline_queue`);
    const items = await this.db.query<{ operation: string; file_path: string; retry_count: number }>(
      `SELECT operation, file_path, COALESCE(retry_count, 0) as retry_count
         FROM offline_queue ORDER BY queued_at ASC, id ASC LIMIT ?`,
      [limit]
    );
    return { total: totalRow[0]?.n ?? 0, items };
  }

  /**
   * Discards ALL queued DELETE operations and returns their paths. Used by the
   * mass-deletion guard's "restore from remote" choice: the caller additionally
   * clears the paths' sync_state so the next full listing re-downloads the files
   * (the reconcile skips paths whose recorded remote_etag still matches).
   */
  async discardPendingDeletes(): Promise<string[]> {
    const paths = await this.getPendingDeletePaths();
    if (paths.length > 0) {
      await this.db.execute(`DELETE FROM offline_queue WHERE operation = 'delete'`);
    }
    return paths;
  }

  /**
   * Enqueues write operations only for local files the remote has NOT confirmed yet
   * (no `remote_etag` in sync_state) and that aren't already queued. Run once after the
   * first successful pull so a fresh index (e.g. after the DB was rebuilt) does not
   * blindly re-push EVERY file over a possibly-newer remote — the pull's reconcile
   * establishes the base for files that exist remotely, and only genuinely local-only
   * files are pushed. `.plainva`/`.CONFLICT` are excluded (device-local).
   */
  async enqueueLocalOnlyFiles(): Promise<void> {
    await this.db.transaction(async () => {
      const files = await this.db.query<{ path: string }>(
        `SELECT f.path FROM files f
         LEFT JOIN sync_state s ON s.path = f.path
         WHERE f.path NOT LIKE '.plainva%'
           AND f.path NOT LIKE '%.CONFLICT%'
           AND (s.path IS NULL OR s.remote_etag IS NULL)`
      );
      for (const row of files) {
        const existing = await this.db.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? LIMIT 1`,
          [row.path]
        );
        if (!existing) {
          await this.db.execute(
            `INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, ?, ?)`,
            [row.path, "write", Date.now()]
          );
          await this.db.execute(
            `UPDATE files SET sync_state = 'local_ahead' WHERE path = ?`,
            [row.path]
          );
        }
      }
    });
  }

  /**
   * Retrieves the operations that are ready to be synced now.
   *
   * Per-file FIFO across replay passes: only the earliest queued operation of each
   * file is eligible, and only if it is ready (not in backoff) and not flagged for
   * manual intervention. Later operations of the same file stay blocked until that
   * head operation is synced or resolved. This prevents a backed-off or blocked head
   * from letting a later operation of the same file leapfrog it between passes
   * (e.g. a rename overtaking a not-yet-synced write). Operations of different files
   * remain independent.
   *
   * Note: we deliberately fetch all rows and apply the per-file gating in TS rather
   * than filtering blocked rows in SQL — filtering them out in SQL would surface a
   * later same-file operation as if it were the head.
   */
  async getPendingOperations(now: number = Date.now()): Promise<SyncOperation[]> {
    // Prefer the most-recently-modified files first (newest mtime → oldest) so
    // recent edits sync first; the per-file FIFO gate below is preserved because
    // all ops of one file share the same files.mtime_local, so the queued_at/id
    // tiebreak keeps that file's ops in enqueue order (its head stays first).
    const rows = await this.db.query<SyncOperation & { requires_manual_intervention?: number | null; _mtime?: number | null }>(
      `SELECT offline_queue.*, files.mtime_local AS _mtime
         FROM offline_queue
         LEFT JOIN files ON files.path = offline_queue.file_path
        ORDER BY files.mtime_local DESC, offline_queue.queued_at ASC, offline_queue.id ASC`
    );
    // Defensive ordering so head detection holds regardless of row source order.
    const ordered = [...rows].sort((a, b) => ((b._mtime ?? 0) - (a._mtime ?? 0)) || (a.queued_at - b.queued_at) || (a.id - b.id));

    const eligible: SyncOperation[] = [];
    const seenFiles = new Set<string>();
    for (const op of ordered) {
      if (seenFiles.has(op.file_path)) continue; // a later op of a file we already gated on
      seenFiles.add(op.file_path);
      if (op.requires_manual_intervention) continue; // head needs manual fix -> whole file blocked
      if (op.next_retry_at > now) continue;          // head in backoff -> whole file waits
      eligible.push(op);
    }
    if (rows.length > 0) {
      const blocked = rows.length - eligible.length;
      console.log(`[SyncQueue] ${eligible.length} eligible / ${rows.length} queued op(s)` + (blocked > 0 ? ` (${blocked} blocked by backoff or manual intervention)` : ""));
    }
    return eligible;
  }

  /**
   * Clears the "blocked" markers (manual-intervention flag and backoff timer) from
   * every queued operation so they become immediately eligible again. Used to
   * recover ops that got stuck after repeated failures (e.g. while push was broken)
   * and to power a manual "retry sync now" action.
   */
  async resetStuckOperations(): Promise<void> {
    await this.db.execute(
      `UPDATE offline_queue
       SET requires_manual_intervention = 0, retry_count = 0, next_retry_at = 0, last_error = NULL`
    );
  }

  async incrementRetry(queueId: number, nextRetryAt: number, lastError?: string): Promise<void> {
    await this.db.execute(
      `UPDATE offline_queue
       SET retry_count = retry_count + 1, next_retry_at = ?, last_error = ?
       WHERE id = ?`,
      [nextRetryAt, lastError || null, queueId]
    );
  }

  async markRequiresManualIntervention(queueId: number, lastError?: string): Promise<void> {
    await this.db.execute(
      `UPDATE offline_queue
       SET retry_count = retry_count + 1,
           requires_manual_intervention = 1,
           last_error = ?,
           next_retry_at = 0
       WHERE id = ?`,
      [lastError || null, queueId]
    );
  }

  /**
   * Removes an operation from the queue once successfully synced.
   */
  async markSynced(queueId: number, originalPath: string, syncedPath: string = originalPath): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.execute(`DELETE FROM offline_queue WHERE id = ?`, [queueId]);
      
      const pending = await this.db.queryOne(
        `SELECT id FROM offline_queue
         WHERE file_path = ? OR file_path = ? OR new_path = ?
         LIMIT 1`,
        [originalPath, syncedPath, syncedPath]
      );
      if (!pending) {
        await this.db.execute(`UPDATE files SET sync_state = 'synced' WHERE path = ?`, [syncedPath]);
      }
    });
  }
}
