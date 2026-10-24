import { parentOf } from "../components/fileTreeModel";

export type IndexPathOutcome = "indexed" | "removed" | "unchanged" | "needs-full-scan";
/** `VaultIndexer.inspectPath`: the two folder cases told apart (issue 122). */
export type InspectPathOutcome = "indexed" | "removed" | "unchanged" | "directory" | "folder-gone";

/** What a flat folder reconcile reports back (VaultIndexer.reconcileFolder). */
export interface FolderReconcileLike {
  indexed: string[];
  removed: string[];
  foldersRemoved: boolean;
  /** The folder's subfolders differ from what the last full scan knew. */
  foldersChanged?: boolean;
}

/** The part of a full scan's report the queue reads (VaultIndexer.IndexScanReport). */
interface ScanReportLike {
  added: number;
  changed: number;
  removed: number;
  foldersChanged: boolean;
}

function asScanReport(value: unknown): ScanReportLike | null {
  const r = value as Partial<ScanReportLike> | null;
  if (!r || typeof r.added !== "number" || typeof r.changed !== "number" || typeof r.removed !== "number"
    || typeof r.foldersChanged !== "boolean") return null;
  return r as ScanReportLike;
}

/** The slice of VaultIndexer this queue drives (kept minimal for testability). */
export interface IncrementalIndexerLike {
  indexPath(path: string): Promise<IndexPathOutcome>;
  /** Preferred over `indexPath` when present: it says which folder case it met. */
  inspectPath?(path: string): Promise<InspectPathOutcome>;
  /**
   * Resolves with the scan report. A report that says what the scan changed
   * decides what is reloaded; anything else counts as "everything may have".
   */
  indexVaultFull(trigger?: string): Promise<unknown>;
  /** Flat reconcile of one folder after a rename/removal (issue 110, E8). */
  reconcileFolder?(folder: string, opts: { recursive: boolean }): Promise<FolderReconcileLike>;
}

/**
 * Why a batch gave up on its paths and ran a full scan. Every value is a way
 * a batch can escalate; `docs/engineering/Vault_Watcher_and_Indexing.md` lists
 * what each platform's watcher has to report to get there.
 */
export type EscalationReason =
  /** The rescan marker: the watcher lost track, failed, or named a path outside the vault. */
  | "rescan requested"
  /** More paths than the per-path route is worth. */
  | "batch above the limit"
  /** A folder was created, renamed or moved in: many paths changed under one name. */
  | "folder created or renamed"
  /** A folder that held indexed files is gone, or a removed file's folder is. */
  | "folder removed or moved away"
  /** One path failed twice, or a folder reconcile failed. */
  | "path could not be indexed";

export interface IndexBatchResult {
  /** A full scan ran. */
  fullScan: boolean;
  /** At least one path was indexed/removed; false for pure echo batches (no bump). */
  anyChange: boolean;
  /** The batch's paths for fileTreeVersionPaths; null after a full scan. */
  paths: string[] | null;
  /**
   * The folder list changed — a subfolder went, or a full scan found the
   * folders on disk different from the last time. Absent when it did not:
   * a full scan that changed nothing reloads nothing (issue 122).
   */
  structureChanged?: boolean;
}

export interface EnqueueOptions {
  /**
   * Paths that came from a rename or removal event: once such a path turns
   * out to have changed the index, its PARENT folder is reconciled flat as
   * well (issue 110) — the other side of a move may never have been reported.
   */
  moved?: string[];
  /**
   * Paths whose ONLY events were plain modifications. For a file that changes
   * nothing. For a folder it is the difference between a full scan and none
   * (issue 122): Windows reports the parent folder of every file written as
   * modified — the app's own saves included — and a folder that was merely
   * modified has no new, renamed or vanished paths below it that a flat look
   * at it would miss. A path named here AND enqueued without it (by another
   * event, or by a caller that knows no event at all) counts as the stronger.
   */
  modifiedOnly?: string[];
  /** Who produced the paths, for the diagnostics line of an escalation ("watcher", "sync", …). */
  source?: string;
}

export interface IncrementalIndexQueue {
  /** Adds paths to the pending set and starts a run if idle. Never throws. */
  enqueue(paths: string[], opts?: EnqueueOptions): void;
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
 * A batch is indexed path by path. It escalates to `indexVaultFull()` only for
 * the reasons named in `EscalationReason`; everything else stays incremental:
 *  - paths are indexed parents-first, so a deleted folder's own event is
 *    classified BEFORE its child deletions remove the rows the folder check
 *    (VaultIndexer.inspectPath child-prefix query) relies on;
 *  - a "removed" file whose parent folder ALSO vanished from disk escalates to
 *    a full scan — the folder was deleted externally, and only the full scan
 *    purges the remaining stale child rows and refreshes the disk-folder list;
 *  - a moved path (rename/removal event) that changed the index has its parent
 *    folder reconciled flat (issue 110, E8). macOS reports the two sides of a
 *    move without pairing them, and a side can go missing; the parent check
 *    removes a row whose file vanished even when nobody named it. A path whose
 *    event changed nothing — the app's own atomic save, already indexed — costs
 *    no folder listing;
 *  - a folder that was only MODIFIED is reconciled flat instead of escalating
 *    (issue 122). Every autosave of a note in a subfolder used to run a full
 *    scan a second later, because Windows names the parent folder as modified.
 *    A folder that was created, renamed or removed still escalates;
 *  - a path that fails once is tried again a moment later before it escalates:
 *    a file another program still holds open, or one that vanished between
 *    the look and the read, is fine on the second attempt, and a full scan
 *    would have met the same file.
 */
export function createIncrementalIndexQueue(opts: {
  indexer: IncrementalIndexerLike;
  /** Disk probe for the removed-path parent check (read-only). */
  exists: (path: string) => Promise<boolean>;
  /** Called after every batch; the host maps the result to version bumps. */
  onBatchDone: (result: IndexBatchResult) => void;
  /** Batch size above which the per-path route is skipped entirely (default 50). */
  maxIncremental?: number;
  /** Called when a batch escalates — counts and tokens only, never a path. */
  onEscalation?: (info: { reason: EscalationReason; sources: string[]; paths: number }) => void;
  /** How long a failed path waits for its second attempt (default 1500 ms). */
  retryDelayMs?: number;
}): IncrementalIndexQueue {
  const maxIncremental = opts.maxIncremental ?? 50;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  const pending = new Set<string>();
  const pendingMoved = new Set<string>();
  /** Pending paths that so far carry nothing but modifications. */
  const pendingWeak = new Set<string>();
  const pendingSources = new Set<string>();
  /** Paths that failed once and are waiting for their second attempt. */
  const failedOnce = new Set<string>();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  let running = false;
  let stopped = false;
  const idleWaiters: Array<() => void> = [];

  const add = (p: string, weak: boolean) => {
    if (weak) {
      if (!pending.has(p)) pendingWeak.add(p);
    } else {
      pendingWeak.delete(p);
    }
    pending.add(p);
  };

  const enqueue = (paths: string[], enqueueOpts?: EnqueueOptions) => {
    if (stopped) return;
    // Strong first: a path named both ways in one call is the stronger one.
    for (const p of paths) add(p, false);
    for (const p of enqueueOpts?.moved ?? []) {
      add(p, false);
      pendingMoved.add(p);
    }
    for (const p of enqueueOpts?.modifiedOnly ?? []) add(p, true);
    if (enqueueOpts?.source) pendingSources.add(enqueueOpts.source);
    if (!running && pending.size > 0) void drain();
  };

  const retryLater = (path: string, moved: boolean, weak: boolean) => {
    failedOnce.add(path);
    const timer = setTimeout(() => {
      retryTimers.delete(timer);
      if (stopped) return;
      enqueue(weak ? [] : [path], { ...(moved ? { moved: [path] } : {}), ...(weak ? { modifiedOnly: [path] } : {}), source: "retry" });
      settleIfIdle();
    }, retryDelayMs);
    retryTimers.add(timer);
  };

  const runBatch = async (
    batch: string[], moved: ReadonlySet<string>, weak: ReadonlySet<string>, sources: string[],
  ): Promise<IndexBatchResult> => {
    let escalation: EscalationReason | null = null;
    // "" is the rescan marker's path — the vault root, which only ever stands
    // for "reconcile everything" (the root's own events never get this far).
    if (batch.includes("")) escalation = "rescan requested";
    else if (batch.length > maxIncremental) escalation = "batch above the limit";
    let anyChange = false;
    let structureChanged = false;
    const removed: string[] = [];
    const extraPaths: string[] = [];
    /** Folders to reconcile flat: parents of moved paths, and folders that were only modified. */
    const folders = new Set<string>();
    if (!escalation) {
      const sorted = [...batch].sort((a, b) => segmentCount(a) - segmentCount(b));
      for (const p of sorted) {
        try {
          const result = opts.indexer.inspectPath ? await opts.indexer.inspectPath(p) : await opts.indexer.indexPath(p);
          failedOnce.delete(p);
          if (result === "directory") {
            if (weak.has(p) && opts.indexer.reconcileFolder) {
              folders.add(p);
              continue;
            }
            escalation = "folder created or renamed";
            break;
          }
          if (result === "needs-full-scan") {
            escalation = "folder created or renamed";
            break;
          }
          if (result === "folder-gone") {
            escalation = "folder removed or moved away";
            break;
          }
          if (result === "removed") removed.push(p);
          if (result === "indexed" || result === "removed") {
            anyChange = true;
            if (moved.has(p)) folders.add(parentOf(p));
          }
        } catch (e) {
          if (!failedOnce.has(p)) {
            console.warn("[incrementalIndexQueue] incremental index failed once, trying again shortly:", p, e);
            retryLater(p, moved.has(p), weak.has(p));
            continue;
          }
          failedOnce.delete(p);
          console.warn("[incrementalIndexQueue] incremental index failed for", p, e);
          escalation = "path could not be indexed";
          break;
        }
      }
    }
    if (!escalation && removed.length > 0) {
      for (const p of removed) {
        const parent = parentOf(p);
        if (parent === "") continue;
        try {
          if (!(await opts.exists(parent))) {
            escalation = "folder removed or moved away";
            break;
          }
        } catch {
          // A failing probe must not block the batch; the file bump still runs.
        }
      }
    }
    if (!escalation && folders.size > 0 && opts.indexer.reconcileFolder) {
      for (const folder of folders) {
        try {
          const r = await opts.indexer.reconcileFolder(folder, { recursive: false });
          if (r.indexed.length > 0 || r.removed.length > 0) {
            anyChange = true;
            extraPaths.push(...r.indexed, ...r.removed);
          }
          if (r.foldersRemoved || r.foldersChanged) structureChanged = true;
        } catch (e) {
          console.warn("[incrementalIndexQueue] folder reconcile failed for", folder, e);
          escalation = "path could not be indexed";
          break;
        }
      }
    }
    if (escalation) {
      try {
        opts.onEscalation?.({ reason: escalation, sources, paths: batch.length });
      } catch (e) {
        console.warn("[incrementalIndexQueue] onEscalation failed", e);
      }
      const trigger = `${sources.length > 0 ? sources.join("+") : "index queue"}: ${escalation}`;
      let report: ScanReportLike | null = null;
      try {
        report = asScanReport(await opts.indexer.indexVaultFull(trigger));
      } catch (e) {
        console.error("[incrementalIndexQueue] full scan failed", e);
      }
      // A scan that failed, or an indexer that does not say what it did:
      // everything may have changed, so everything reloads — as it always did.
      if (!report) return { fullScan: true, anyChange: true, paths: null, structureChanged: true };
      const filesChanged = report.added + report.changed + report.removed > 0;
      return {
        fullScan: true,
        anyChange: filesChanged || report.foldersChanged,
        paths: null,
        ...(report.foldersChanged ? { structureChanged: true } : {}),
      };
    }
    const paths = extraPaths.length > 0 ? [...new Set([...batch, ...extraPaths])] : batch;
    return { fullScan: false, anyChange, paths, ...(structureChanged ? { structureChanged } : {}) };
  };

  const settleIfIdle = () => {
    if (running || pending.size > 0 || retryTimers.size > 0) return;
    while (idleWaiters.length > 0) idleWaiters.shift()!();
  };

  const drain = async () => {
    running = true;
    try {
      while (pending.size > 0) {
        const batch = Array.from(pending);
        const moved = new Set(pendingMoved);
        const weak = new Set(pendingWeak);
        const sources = Array.from(pendingSources).sort();
        pending.clear();
        pendingMoved.clear();
        pendingWeak.clear();
        pendingSources.clear();
        const result = await runBatch(batch, moved, weak, sources);
        try {
          if (!stopped) opts.onBatchDone(result);
        } catch (e) {
          console.error("[incrementalIndexQueue] onBatchDone failed", e);
        }
      }
    } finally {
      running = false;
      settleIfIdle();
    }
  };

  return {
    enqueue,
    whenIdle() {
      if (!running && pending.size === 0 && retryTimers.size === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    stop() {
      stopped = true;
      pending.clear();
      pendingMoved.clear();
      pendingWeak.clear();
      pendingSources.clear();
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      failedOnce.clear();
      settleIfIdle();
    },
  };
}
