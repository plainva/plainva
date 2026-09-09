import type { DeletionConfirmation } from "../vault/IVaultAdapter.js";
import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { SyncOperation } from "./ISyncTarget.js";

function containsPath(parent: string, path: string): boolean {
  return path === parent || path.startsWith(parent + "/");
}

function overlaps(a: string, b: string): boolean {
  return containsPath(a, b) || containsPath(b, a);
}

function endpoints(op: SyncOperation): string[] {
  return op.new_path ? [op.file_path, op.new_path] : [op.file_path];
}

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
  async queueWrite(path: string, options?: { force?: boolean }): Promise<void> {
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
        `INSERT INTO offline_queue (file_path, operation, queued_at, force) VALUES (?, ?, ?, ?)`,
        [path, "write", Date.now(), options?.force ? 1 : 0]
      );

      // Update sync_state in files table
      await this.db.execute(
        `UPDATE files SET sync_state = 'local_ahead' WHERE path = ?`,
        [path]
      );
    });
  }

  /**
   * A scan may repeat the same missing-file observation. A new confirmed
   * filesystem deletion always gets its own identity; writes/creates/moves
   * since an older delete also start a new generation.
   */
  async queueDelete(path: string, confirmation?: DeletionConfirmation): Promise<void> {
    await this.queueDeletePaths([path], confirmation);
  }

  /** One successful recursive delete records its actual children atomically. */
  async queueDeletePaths(paths: ReadonlyArray<string>, confirmation?: DeletionConfirmation): Promise<void> {
    const at = Date.now();
    await this.db.transaction(async () => {
      for (const path of new Set(paths)) {
        if (!confirmation?.confirmed) {
          const existing = await this.db.queryOne<{ id: number }>(
            `SELECT id FROM offline_queue WHERE file_path = ? AND operation = 'delete' ORDER BY id DESC LIMIT 1`,
            [path]
          );
          if (existing) {
            const later = await this.db.query<SyncOperation>(
              `SELECT * FROM offline_queue WHERE id > ? AND operation IN ('write', 'mkdir', 'rename')`,
              [existing.id]
            );
            if (!later.some((op) => endpoints(op).some((p) => overlaps(p, path)))) continue;
          }
        }
        await this.db.execute(
          `INSERT INTO offline_queue (file_path, operation, queued_at, delete_confirmed_at) VALUES (?, ?, ?, ?)`,
          [path, "delete", at, confirmation?.confirmed ? at : null]
        );
        await this.db.execute(
          `UPDATE files SET sync_state = 'local_ahead', is_deleted = 1 WHERE path = ?`,
          [path]
        );
      }
    });
  }

  async getPendingDeleteOperations(): Promise<SyncOperation[]> {
    return this.db.query<SyncOperation>(`SELECT * FROM offline_queue WHERE operation = 'delete' ORDER BY id`);
  }

  async markDeletesJournaled(ids: ReadonlyArray<number>): Promise<void> {
    await this.db.transaction(async () => {
      for (const id of ids) {
        await this.db.execute(`UPDATE offline_queue SET delete_journaled = 1 WHERE id = ? AND operation = 'delete'`, [id]);
      }
    });
  }

  /** Coalesce repeated creates only while no intervening delete/move starts a new generation. */
  async queueMkdir(path: string): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM offline_queue WHERE file_path = ? AND operation = 'mkdir' ORDER BY id DESC LIMIT 1`,
        [path]
      );
      if (existing) {
        const later = await this.db.query<SyncOperation>(
          `SELECT * FROM offline_queue WHERE id > ? AND operation IN ('delete', 'rename')`, [existing.id]
        );
        if (!later.some((op) => endpoints(op).some((p) => overlaps(p, path)))) return;
      }
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

      // Structural operations describe remote history: never rewrite their
      // original source or destination. The MOVE must precede writes of the
      // local content now living at its destination.
      await this.db.execute(
        `INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES (?, ?, ?, ?)`,
        [oldPath, "rename", newPath, Date.now()]
      );

      const writes = await this.db.query<{ id: number; file_path: string }>(
        `SELECT id, file_path FROM offline_queue WHERE operation = 'write' ORDER BY id`
      );
      for (const op of writes) {
        if (!containsPath(oldPath, op.file_path)) continue;
        const path = op.file_path === oldPath ? newPath : newPrefix + op.file_path.substring(oldPrefix.length);
        // New identity also protects against an upload already in flight: its
        // completion/retry refers to the retired ID, never this follow-up write.
        // Preserve age, forced encryption and unresolved failure information.
        await this.db.execute(
          `INSERT INTO offline_queue
            (file_path, operation, content, queued_at, retry_count, next_retry_at,
             priority, last_error, requires_manual_intervention, force)
           SELECT ?, operation, content, queued_at, retry_count, next_retry_at,
                  priority, last_error, requires_manual_intervention, force
           FROM offline_queue WHERE id = ?`,
          [path, op.id]
        );
        await this.db.execute(`DELETE FROM offline_queue WHERE id = ?`, [op.id]);
      }

      // 3. Update files table: exact match AND all children (if it was a folder)
      // Setting mtime_local = 0 forces the indexer to re-read the file to update title/FTS properly.
      // Literal, case-sensitive prefix matching. SQL length counts characters
      // consistently with substr, including names containing non-BMP symbols.
      const files = await this.db.query<{path: string}>(
        `SELECT path FROM files WHERE path = ? COLLATE BINARY OR substr(path, 1, length(?)) = ? COLLATE BINARY`,
        [oldPath, oldPrefix, oldPrefix]
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

      // 4. Move sync_state the same way — it is keyed by path just like `files`.
      // Everything keyed by a path moves when the path moves; leaving this behind
      // stranded the merge base (base_sha256/base_text) under the old key, so the
      // new path looked like a brand-new file to the indexer, which recorded
      // local content with NO base. The next divergence then had no common
      // ancestor to merge against and was preserved as a .CONFLICT copy instead
      // (issue #48). Same literal prefix as step 3.
      const states = await this.db.query<{path: string}>(
        `SELECT path FROM sync_state WHERE path = ? COLLATE BINARY OR substr(path, 1, length(?)) = ? COLLATE BINARY`,
        [oldPath, oldPrefix, oldPrefix]
      );

      for (const s of states) {
        const p = s.path;
        const updatedPath = p === oldPath ? newPath : newPath + p.substring(oldLen);
        // A row can already sit at the target: a file deleted there earlier keeps
        // its state on purpose (the remote delete must still be pushed). The row
        // arriving with the rename is the one that describes this file, so it wins.
        await this.db.execute(`DELETE FROM sync_state WHERE path = ?`, [updatedPath]);
        await this.db.execute(`UPDATE sync_state SET path = ? WHERE path = ?`, [updatedPath, p]);
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
   * Content-E2E migration sweep (settings-sync plan §3.5): force-enqueues a write
   * for EVERY local file so the (wrapping) worker re-uploads it as ciphertext,
   * even files already in sync. `force = 1` makes SyncEngine.processQueue bypass
   * the "already in sync, skip" shortcut and the optimistic-concurrency guard, so
   * the plaintext-unchanged file is still pushed. A file that already has a
   * pending structural op (rename/delete) is left alone (that op wins); a pending
   * plain write is upgraded to a forced write. `.plainva`/`.CONFLICT` are
   * device-local and never encrypted. Returns the number of files queued/upgraded.
   */
  async enqueueAllForReencrypt(): Promise<number> {
    let n = 0;
    await this.db.transaction(async () => {
      const files = await this.db.query<{ path: string }>(
        `SELECT path FROM files WHERE path NOT LIKE '.plainva%' AND path NOT LIKE '%.CONFLICT%'`
      );
      for (const row of files) {
        const structural = await this.db.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? AND operation IN ('rename', 'delete') LIMIT 1`,
          [row.path]
        );
        if (structural) continue;
        const pendingWrite = await this.db.queryOne<{ id: number }>(
          `SELECT id FROM offline_queue WHERE file_path = ? AND operation = 'write' LIMIT 1`,
          [row.path]
        );
        if (pendingWrite) {
          await this.db.execute(
            `UPDATE offline_queue SET force = 1 WHERE file_path = ? AND operation = 'write'`,
            [row.path]
          );
        } else {
          await this.db.execute(
            `INSERT INTO offline_queue (file_path, operation, queued_at, force) VALUES (?, 'write', ?, 1)`,
            [row.path, Date.now()]
          );
          await this.db.execute(
            `UPDATE files SET sync_state = 'local_ahead' WHERE path = ?`,
            [row.path]
          );
        }
        n++;
      }
    });
    return n;
  }

  /** Snapshot used by the E2E lifecycle gate. Strict/plain may only be
   * published when every forced sweep write has completed and no queued item
   * is blocked for manual intervention. */
  async getEncryptionSweepStatus(): Promise<{ forcedPending: number; pending: number; failed: number; manual: number }> {
    const row = await this.db.queryOne<{ forced_pending: number; pending: number; failed: number; manual: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN force = 1 THEN 1 ELSE 0 END), 0) AS forced_pending,
         COUNT(*) AS pending,
         COALESCE(SUM(CASE WHEN retry_count > 0 OR last_error IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN requires_manual_intervention = 1 THEN 1 ELSE 0 END), 0) AS manual
       FROM offline_queue`
    );
    return {
      forcedPending: Number(row?.forced_pending ?? 0),
      pending: Number(row?.pending ?? 0),
      failed: Number(row?.failed ?? 0),
      manual: Number(row?.manual ?? 0),
    };
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
       WHERE (file_path = ? OR new_path = ?
          OR substr(?, 1, length(file_path) + 1) = file_path || '/'
          OR substr(?, 1, length(new_path) + 1) = new_path || '/')
         AND operation IN ('rename', 'delete')
       LIMIT 1`,
      [path, path, path, path]
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
    const rows = await this.db.query<{ file_path: string; new_path: string | null }>(
      `SELECT file_path, new_path FROM offline_queue WHERE operation IN ('delete', 'rename')`
    );
    return rows.flatMap((r) => r.new_path ? [r.file_path, r.new_path] : [r.file_path]);
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
   * Discards the selected DELETE operations (all when no IDs are supplied). Used by the
   * mass-deletion guard's "restore from remote" choice: the caller additionally
   * clears the paths' sync_state so the next full listing re-downloads the files
   * (the reconcile skips paths whose recorded remote_etag still matches).
   */
  async discardPendingDeletes(ids?: ReadonlySet<number>): Promise<string[]> {
    if (ids) {
      const rows = (await this.getPendingDeleteOperations()).filter((op) => ids.has(op.id));
      await this.db.transaction(async () => {
        for (const row of rows) await this.db.execute(`DELETE FROM offline_queue WHERE id = ? AND operation = 'delete'`, [row.id]);
      });
      return [...new Set(rows.map((row) => row.file_path))];
    }
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
   * Structural operations gate both endpoints and their descendants. A backed
   * off/manual operation remains a dependency. IDs preserve enqueue order even
   * across clock changes; mtime only prioritizes independent ready operations.
   */
  async getPendingOperations(now: number = Date.now()): Promise<SyncOperation[]> {
    const rows = await this.db.query<SyncOperation & { requires_manual_intervention?: number | null; _mtime?: number | null }>(
      `SELECT offline_queue.*, files.mtime_local AS _mtime
         FROM offline_queue
         LEFT JOIN files ON files.path = offline_queue.file_path
        ORDER BY offline_queue.id ASC`
    );
    const ordered = [...rows].sort((a, b) => a.id - b.id);
    const renames = ordered.filter((op) => op.operation === "rename" && op.new_path);
    const structures = ordered.filter((op) => op.operation !== "write");
    const followsRename = (write: SyncOperation, rename: SyncOperation): boolean =>
      !!rename.new_path && containsPath(rename.new_path, write.file_path)
      && (write.id > rename.id || !structures.some((between) =>
        between.id > write.id && between.id < rename.id
        && endpoints(between).some((p) => overlaps(p, write.file_path))));
    const earlierStructures: SyncOperation[] = [];
    const earlierWrites = new Set<string>();
    const earlierWriteOps: SyncOperation[] = [];
    const eligible: typeof rows = [];
    for (const op of ordered) {
      let blocked: boolean;
      if (op.operation === "write") {
        // Old versions rewrote writes in place BEFORE inserting the MOVE.
        // Such persisted rows must also wait for their destination's MOVE.
        blocked = earlierWrites.has(op.file_path)
          || earlierStructures.some((prior) => endpoints(prior).some((p) => overlaps(p, op.file_path)))
          || renames.some((rename) => followsRename(op, rename));
        earlierWrites.add(op.file_path);
        earlierWriteOps.push(op);
      } else {
        blocked = earlierStructures.some((prior) => endpoints(prior).some((p) => endpoints(op).some((q) => overlaps(p, q))))
          || earlierWriteOps.some((write) =>
            !(op.operation === "rename" && followsRename(write, op))
            && endpoints(op).some((q) => overlaps(write.file_path, q)));
        earlierStructures.push(op);
      }
      if (!blocked && !op.requires_manual_intervention && !(op.next_retry_at > now)) eligible.push(op);
    }
    eligible.sort((a, b) => ((b._mtime ?? 0) - (a._mtime ?? 0)) || a.id - b.id);
    if (rows.length > 0) {
      console.log(`[SyncQueue] ${eligible.length} eligible / ${rows.length} queued op(s)`);
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
