import { parentOf } from "../components/fileTreeModel";

export type IndexPathOutcome = "indexed" | "removed" | "unchanged" | "needs-full-scan";

/** What a flat folder reconcile reports back (VaultIndexer.reconcileFolder). */
export interface FolderReconcileLike {
  indexed: string[];
  removed: string[];
  foldersRemoved: boolean;
}

/** The slice of VaultIndexer this queue drives (kept minimal for testability). */
export interface IncrementalIndexerLike {
  indexPath(path: string): Promise<IndexPathOutcome>;
  /** Resolves with the scan report; the queue only cares that it finished. */
  indexVaultFull(): Promise<unknown>;
  /** Flat reconcile of one folder after a rename/removal (issue 110, E8). */
  reconcileFolder?(folder: string, opts: { recursive: boolean }): Promise<FolderReconcileLike>;
}

export interface IndexBatchResult {
  /** A full scan ran — the folder structure may have changed (structural bump). */
  fullScan: boolean;
  /** At least one path was indexed/removed; false for pure echo batches (no bump). */
  anyChange: boolean;
  /** The batch's paths for fileTreeVersionPaths; null after a full scan. */
  paths: string[] | null;
  /** A folder reconcile found a subfolder gone — the folder list changed too. */
  structureChanged?: boolean;
}

export interface IncrementalIndexQueue {
  /**
   * Adds paths to the pending set and starts a run if idle. Never throws.
   * `moved` names the paths that came from a rename or removal event: once
   * such a path turns out to have changed the index, its PARENT folder is
   * reconciled flat as well (issue 110) — the other side of a move may never
   * have been reported.
   */
  enqueue(paths: string[], opts?: { moved?: string[] }): void;
  /** Resolves once all work pending at call time has drained (test hook). */
  whenIdle(): Promise<void>;
  /** Discards future work; an already-running index operation may finish. */
  stop(): void;
}

const segmentCount = (p: string) => p.replace(/\\/g, "/").split("/").length;

/**
 * Serialized incremental indexing for changed-path batches (watcher events and
 * sync pulls). One async runner processes one batch at a time; paths enqueued
 * while a run is in flight coalesce into a SINGLE follow-up batch. That both
 * serializes the two producers (no interleaved index passes on the same DB) and
 * collapses redundant full scans: N folder events arriving during one running
 * scan cost exactly one follow-up scan, not N — the pre-queue behavior during a
 * first sync was one full scan per watcher folder event.
 *
 * Batch classification mirrors the former VaultContext.applyIncrementalIndex:
 * more than `maxIncremental` paths, a directory path ("needs-full-scan") or an
 * indexPath error fall back to `indexVaultFull()`. Additions:
 *  - paths are indexed parents-first, so a deleted folder's own event is
 *    classified BEFORE its child deletions remove the rows the folder check
 *    (VaultIndexer.indexPath child-prefix query) relies on;
 *  - a "removed" file whose parent folder ALSO vanished from disk escalates to
 *    a full scan — the folder was deleted externally, and only the full scan
 *    purges the remaining stale child rows and refreshes the disk-folder list;
 *  - a moved path (rename/removal event) that changed the index has its parent
 *    folder reconciled flat (issue 110, E8). macOS reports the two sides of a
 *    move without pairing them, and a side can go missing; the parent check
 *    removes a row whose file vanished even when nobody named it. A path whose
 *    event changed nothing — the app's own atomic save, already indexed — costs
 *    no folder listing.
 */
export function createIncrementalIndexQueue(opts: {
  indexer: IncrementalIndexerLike;
  /** Disk probe for the removed-path parent check (read-only). */
  exists: (path: string) => Promise<boolean>;
  /** Called after every batch; the host maps the result to version bumps. */
  onBatchDone: (result: IndexBatchResult) => void;
  /** Batch size above which the per-path route is skipped entirely (default 50). */
  maxIncremental?: number;
}): IncrementalIndexQueue {
  const maxIncremental = opts.maxIncremental ?? 50;
  const pending = new Set<string>();
  const pendingMoved = new Set<string>();
  let running = false;
  let stopped = false;
  const idleWaiters: Array<() => void> = [];

  const runBatch = async (batch: string[], moved: ReadonlySet<string>): Promise<IndexBatchResult> => {
    let fullScan = batch.length > maxIncremental;
    let anyChange = false;
    let structureChanged = false;
    const removed: string[] = [];
    const extraPaths: string[] = [];
    const parents = new Set<string>();
    if (!fullScan) {
      const sorted = [...batch].sort((a, b) => segmentCount(a) - segmentCount(b));
      for (const p of sorted) {
        try {
          const result = await opts.indexer.indexPath(p);
          if (result === "needs-full-scan") {
            fullScan = true;
            break;
          }
          if (result === "removed") removed.push(p);
          if (result === "indexed" || result === "removed") {
            anyChange = true;
            if (moved.has(p)) parents.add(parentOf(p));
          }
        } catch (e) {
          console.warn("[incrementalIndexQueue] incremental index failed for", p, e);
          fullScan = true;
          break;
        }
      }
    }
    if (!fullScan && removed.length > 0) {
      for (const p of removed) {
        const parent = parentOf(p);
        if (parent === "") continue;
        try {
          if (!(await opts.exists(parent))) {
            fullScan = true;
            break;
          }
        } catch {
          // A failing probe must not block the batch; the file bump still runs.
        }
      }
    }
    if (!fullScan && parents.size > 0 && opts.indexer.reconcileFolder) {
      for (const folder of parents) {
        try {
          const r = await opts.indexer.reconcileFolder(folder, { recursive: false });
          if (r.indexed.length > 0 || r.removed.length > 0) {
            anyChange = true;
            extraPaths.push(...r.indexed, ...r.removed);
          }
          if (r.foldersRemoved) structureChanged = true;
        } catch (e) {
          console.warn("[incrementalIndexQueue] folder reconcile failed for", folder, e);
          fullScan = true;
          break;
        }
      }
    }
    if (fullScan) {
      await opts.indexer
        .indexVaultFull()
        .catch((e) => console.error("[incrementalIndexQueue] full scan failed", e));
      return { fullScan: true, anyChange: true, paths: null };
    }
    const paths = extraPaths.length > 0 ? [...new Set([...batch, ...extraPaths])] : batch;
    return { fullScan: false, anyChange, paths, ...(structureChanged ? { structureChanged } : {}) };
  };

  const drain = async () => {
    running = true;
    try {
      while (pending.size > 0) {
        const batch = Array.from(pending);
        const moved = new Set(pendingMoved);
        pending.clear();
        pendingMoved.clear();
        const result = await runBatch(batch, moved);
        try {
          if (!stopped) opts.onBatchDone(result);
        } catch (e) {
          console.error("[incrementalIndexQueue] onBatchDone failed", e);
        }
      }
    } finally {
      running = false;
      while (idleWaiters.length > 0) idleWaiters.shift()!();
    }
  };

  return {
    enqueue(paths: string[], enqueueOpts?: { moved?: string[] }) {
      if (stopped) return;
      for (const p of paths) pending.add(p);
      for (const p of enqueueOpts?.moved ?? []) {
        pending.add(p);
        pendingMoved.add(p);
      }
      if (!running && pending.size > 0) void drain();
    },
    whenIdle() {
      if (!running && pending.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    stop() { stopped = true; pending.clear(); pendingMoved.clear(); },
  };
}
