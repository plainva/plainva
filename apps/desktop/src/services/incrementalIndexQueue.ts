import { parentOf } from "../components/fileTreeModel";

export type IndexPathOutcome = "indexed" | "removed" | "unchanged" | "needs-full-scan";

/** The slice of VaultIndexer this queue drives (kept minimal for testability). */
export interface IncrementalIndexerLike {
  indexPath(path: string): Promise<IndexPathOutcome>;
  indexVaultFull(): Promise<void>;
}

export interface IndexBatchResult {
  /** A full scan ran — the folder structure may have changed (structural bump). */
  fullScan: boolean;
  /** At least one path was indexed/removed; false for pure echo batches (no bump). */
  anyChange: boolean;
  /** The batch's paths for fileTreeVersionPaths; null after a full scan. */
  paths: string[] | null;
}

export interface IncrementalIndexQueue {
  /** Adds paths to the pending set and starts a run if idle. Never throws. */
  enqueue(paths: string[]): void;
  /** Resolves once all work pending at call time has drained (test hook). */
  whenIdle(): Promise<void>;
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
 * indexPath error fall back to `indexVaultFull()`. Two additions:
 *  - paths are indexed parents-first, so a deleted folder's own event is
 *    classified BEFORE its child deletions remove the rows the folder check
 *    (VaultIndexer.indexPath child-prefix query) relies on;
 *  - a "removed" file whose parent folder ALSO vanished from disk escalates to
 *    a full scan — the folder was deleted externally, and only the full scan
 *    purges the remaining stale child rows and refreshes the disk-folder list.
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
  let running = false;
  const idleWaiters: Array<() => void> = [];

  const runBatch = async (batch: string[]): Promise<IndexBatchResult> => {
    let fullScan = batch.length > maxIncremental;
    let anyChange = false;
    const removed: string[] = [];
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
          if (result === "indexed" || result === "removed") anyChange = true;
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
    if (fullScan) {
      await opts.indexer
        .indexVaultFull()
        .catch((e) => console.error("[incrementalIndexQueue] full scan failed", e));
      return { fullScan: true, anyChange: true, paths: null };
    }
    return { fullScan: false, anyChange, paths: batch };
  };

  const drain = async () => {
    running = true;
    try {
      while (pending.size > 0) {
        const batch = Array.from(pending);
        pending.clear();
        const result = await runBatch(batch);
        try {
          opts.onBatchDone(result);
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
    enqueue(paths: string[]) {
      for (const p of paths) pending.add(p);
      if (!running && pending.size > 0) void drain();
    },
    whenIdle() {
      if (!running && pending.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
