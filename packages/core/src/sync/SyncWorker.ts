import { SyncEngine } from "./SyncEngine.js";
import { ISyncTarget } from "./ISyncTarget.js";
import { SyncStateRepository, SyncState } from "../vault/SyncStateRepository.js";
import { SyncQueue } from "./SyncQueue.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { mergeText } from "../conflict-resolver.js";
import { isTextFile } from "./fileType.js";

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", data));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/**
 * Paths that must never participate in sync. `.plainva/` holds device-local state
 * — the SQLite index (`vault.db` plus its `-wal`/`-shm` sidecars), graph pins and
 * bookmarks — and `.CONFLICT-<ts>` files are local conflict copies. The push side
 * already excludes these (SyncQueue's `NOT LIKE '.plainva%'` and the VaultContext
 * enqueue guards); the pull side must match. Otherwise a remote `.plainva/vault.db`
 * — e.g. uploaded to the same folder by a Google Drive / Dropbox / OneDrive
 * *desktop* client that mirrors the vault independently — gets downloaded on top of
 * the live local index and corrupts it ("database disk image is malformed").
 */
export function isLocalOnlyPath(path: string): boolean {
  return path.startsWith(".plainva") || path.includes(".CONFLICT");
}

export type SyncStatus = "idle" | "syncing" | "error";

/**
 * Coarse progress of the running cycle (WP6): which phase (pulling the remote
 * listing vs pushing the local queue) and how far through it. `total` is known
 * upfront (remote listing size / pending-operation count); emission is throttled
 * so a fast no-op poll never floods the UI. Surfaced only while "syncing" is
 * actually shown (past the anti-flicker delay), i.e. on long/initial syncs.
 */
export interface SyncProgress {
  phase: "pull" | "push";
  current: number;
  total: number;
}

/** Upper bound for the adaptive pull backoff (a failing server is retried at most this slowly). */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * How many incremental (cursor) pulls to run between full listings for change-token
 * providers (Drive). The periodic full listing re-seeds the adapter's id<->path caches,
 * catches remotely-created files whose parent a bare change cannot resolve, and runs the
 * authoritative missing-from-listing deletion mirror. At the 15 s default this is a full
 * listing roughly every 5 minutes; every cycle in between is one cheap changes.list call.
 */
const FULL_LISTING_EVERY_N_CYCLES = 20;

/**
 * Emit onFilesChanged in chunks of this many paths while the cycle is still running.
 * Deliberately below the desktop's incremental-index batch cap (50 paths), so every
 * chunk takes the cheap per-path index route; pulled files appear in the tree
 * progressively during a long first sync instead of only after the whole cycle.
 */
const CHANGED_PATHS_CHUNK = 25;

/**
 * Abort the pull phase after this many reconcile ATTEMPTS failing in a row (mirrors
 * SyncEngine's consecutive-failure breaker on the push side): one poisoned file must
 * not starve the rest of the pull, but an unbroken failure streak looks like a
 * provider/network outage — abort, back off, retry the whole cycle later.
 */
const MAX_CONSECUTIVE_PULL_FAILURES = 3;

export class SyncWorker {
  private timeoutId: any;
  private isRunning = false;
  private isSyncing = false;
  private pendingSyncRequest = false;
  public onStatusChange?: (status: SyncStatus, error?: string) => void;
  /**
   * Fired for local files changed by the running cycle (pulled writes, conflict
   * files or mirrored deletions). The desktop wires this to a re-index + file-tree
   * refresh so pulled changes become visible deterministically, independent of OS
   * filesystem-watch reliability. Delivery guarantee: paths are emitted in chunks
   * WHILE the cycle runs (progressive tree updates during a long first sync) and a
   * final flush runs even when the cycle aborts (error, breaker or stop) — each
   * file's sync_state advances the moment it is reconciled, so a write this cycle
   * never reports would otherwise stay invisible until an app restart. Each path
   * is reported exactly once per cycle.
   */
  public onFilesChanged?: (paths: string[]) => void;
  /**
   * Coarse cycle progress for the status bar (WP6). Throttled to ~7/s via
   * `lastProgressAt`; the terminal `null` marks "no active progress".
   */
  public onProgress?: (progress: SyncProgress | null) => void;
  private lastProgressAt = 0;
  private currentStatus: SyncStatus = "idle";
  /** Consecutive failed cycles; drives the adaptive pull backoff (reset on success). */
  private consecutiveFailures = 0;
  /**
   * Fired once, after the first cycle whose pull succeeded. The desktop uses this to
   * enqueue genuinely local-only files (those the remote did not confirm) for push —
   * after a fresh index the initial push is deliberately deferred to the first pull so
   * a rebuilt DB cannot blindly overwrite a newer remote. See 3c / enqueueLocalOnlyFiles.
   */
  public onFirstCycleComplete?: () => void;
  private firstCycleComplete = false;
  /**
   * Incremental-pull state for change-token providers (Drive). `cursor` is the change
   * token from the last pull; `cyclesSinceFull` forces a periodic full listing. Both live
   * only in memory for the session: a full listing must run first each session anyway to
   * seed the adapter's id<->path caches that changes.list maps against, so there is nothing
   * to persist across restarts. An undefined `cursor` (WebDAV/S3/OneDrive/Dropbox, or any
   * target without getStartCursor) means every cycle is a full listing, exactly as before.
   */
  private cursor?: string;
  private cyclesSinceFull = 0;

  private emitProgress(phase: "pull" | "push", current: number, total: number) {
    if (!this.onProgress || total <= 0) return;
    const now = Date.now();
    // Always emit the final tick; throttle the rest so no-op polls stay quiet.
    if (current < total && now - this.lastProgressAt < 150) return;
    this.lastProgressAt = now;
    this.onProgress({ phase, current, total });
  }

  constructor(
    private readonly engine: SyncEngine,
    private readonly target: ISyncTarget,
    private readonly stateRepo: SyncStateRepository,
    /**
     * Raw vault adapter for the worker's own writes. This must NOT be the
     * queueing/conflict-aware adapter: the worker performs its own merge and
     * manages sync_state itself, so routing its writes through the queue would
     * re-enqueue every pulled file and run a redundant second merge on top of
     * the worker's merge. A backup-capable raw adapter keeps pre-overwrite
     * safety without those side effects.
     */
    private readonly vault: IVaultAdapter,
    private readonly queue: SyncQueue,
    private readonly intervalMs: number = 60000
  ) {}

  private setStatus(status: SyncStatus, error?: string) {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      if (this.onStatusChange) {
        this.onStatusChange(status, error);
      }
    } else if (status === "error" && this.onStatusChange) {
      this.onStatusChange(status, error);
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[SyncWorker] started (poll interval ${this.intervalMs}ms)`);
    // Recover operations that got stuck (manual-intervention / backoff) in a
    // previous session before running the first cycle, then sync.
    this.queue.resetStuckOperations()
      .catch((e) => console.error("[SyncWorker] resetStuckOperations failed:", e))
      .finally(() => { if (this.isRunning) this.executeCycle(); });
  }

  /**
   * Manual "retry now": unblock any stuck/backed-off operations and sync
   * immediately. Wired to the sync status icon.
   */
  public async retryFailed() {
    if (!this.isRunning) {
      console.warn("[SyncWorker] retryFailed ignored: worker not running");
      return;
    }
    console.log("[SyncWorker] manual retry: resetting stuck operations");
    try {
      await this.queue.resetStuckOperations();
    } catch (e) {
      console.error("[SyncWorker] resetStuckOperations failed:", e);
    }
    this.triggerImmediate();
  }

  public stop() {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  public triggerImmediate() {
    if (!this.isRunning) {
      console.warn("[SyncWorker] triggerImmediate ignored: worker not running");
      return;
    }
    if (this.isSyncing) {
      console.log("[SyncWorker] trigger while syncing -> queued for next slot");
      this.pendingSyncRequest = true;
      return;
    }
    console.log("[SyncWorker] immediate sync triggered");
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.executeCycle();
  }

  private scheduleNext() {
    if (!this.isRunning) return;
    // Adaptive backoff: after consecutive failures (e.g. server down) the poll interval
    // grows exponentially up to a cap instead of hammering every interval. A successful
    // cycle resets it; manual triggers / local changes still fire immediately.
    const delay = this.consecutiveFailures > 0
      ? Math.min(this.intervalMs * 2 ** this.consecutiveFailures, MAX_BACKOFF_MS)
      : this.intervalMs;
    if (this.consecutiveFailures > 0) {
      console.log(`[SyncWorker] backoff: next cycle in ${Math.round(delay / 1000)}s after ${this.consecutiveFailures} failure(s)`);
    }
    this.timeoutId = setTimeout(() => {
      this.executeCycle();
    }, delay);
  }

  private async executeCycle() {
    if (!this.isRunning || this.isSyncing) return;
    this.isSyncing = true;
    try {
      await this.runCycle();
    } finally {
      this.isSyncing = false;
      if (this.isRunning) {
        if (this.pendingSyncRequest) {
          this.pendingSyncRequest = false;
          // Schedule immediately instead of next interval
          this.timeoutId = setTimeout(() => this.executeCycle(), 0);
        } else {
          this.scheduleNext();
        }
      }
    }
  }

  private conflictPathFor(path: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extMatch = path.match(/(\.[^.]+)$/);
    const ext = extMatch ? extMatch[1] : "";
    const base = extMatch ? path.substring(0, path.length - ext.length) : path;
    return `${base}.CONFLICT-${timestamp}${ext}`;
  }

  /**
   * Preserves the local version of a diverged file as a .CONFLICT-<ts> sibling so
   * no local edits are lost when we adopt the remote version. .CONFLICT files are
   * excluded from pushes by the sync target, so they stay local-only.
   */
  private async preserveLocalAsConflict(path: string, localContent: string): Promise<string> {
    const conflictPath = this.conflictPathFor(path);
    console.warn(`[SyncWorker] CONFLICT: preserving local copy of ${path} as ${conflictPath}`);
    await this.vault.writeTextFile(conflictPath, localContent);
    return conflictPath;
  }

  /**
   * Byte-wise reconciliation for binary files (no text decode, no 3-way merge). If the
   * local copy diverged from both the base and the remote, it is preserved as a binary
   * `.CONFLICT` sibling and the remote is adopted; otherwise the remote is fast-forwarded
   * in. Binary files are never pushed from here (a local binary change is pushed via the
   * queue), so the local copy always ends up equal to the remote after this.
   */
  private async reconcileBinaryFile(
    path: string,
    contentBytes: Uint8Array,
    remoteEtag: string,
    state: SyncState | null,
    now: number,
    changedPaths: string[]
  ): Promise<void> {
    const remoteSha = await sha256Bytes(contentBytes);
    const localExists = await this.vault.exists(path);
    let writeNeeded = !localExists;

    if (localExists) {
      const localBytes = await this.vault.readBinaryFile(path);
      const localSha = await sha256Bytes(localBytes);
      if (localSha === remoteSha) {
        writeNeeded = false; // identical content
      } else if (state && state.base_sha256 && localSha === state.base_sha256) {
        writeNeeded = true; // local unchanged since base -> fast-forward to remote
      } else {
        // Diverged (both changed, or no reliable base): keep local as .CONFLICT, adopt remote.
        const conflictPath = this.conflictPathFor(path);
        console.warn(`[SyncWorker] CONFLICT (binary): ${path} diverged (localSha=${localSha.slice(0, 8)}, remoteSha=${remoteSha.slice(0, 8)}, base=${state?.base_sha256?.slice(0, 8) ?? "none"})`);
        await this.vault.writeBinaryFile(conflictPath, localBytes);
        changedPaths.push(conflictPath);
        writeNeeded = true;
      }
    }

    if (!this.isRunning) return;

    if (writeNeeded) {
      await this.vault.writeBinaryFile(path, contentBytes);
      changedPaths.push(path);
    }

    // Local is now aligned with the remote; record state with a byte hash (no base_text).
    await this.stateRepo.updateLocalHash(path, remoteSha);
    await this.stateRepo.updateRemoteState(path, remoteEtag, state?.remote_id ?? null, now);
    await this.stateRepo.updateBaseState(path, remoteSha, remoteEtag);
  }

  /**
   * Mirrors a remote deletion for one path, but only when the local copy is UNCHANGED
   * since the last sync — a locally-modified file is kept (it resurfaces as a local-ahead
   * change) rather than destroyed. Device-local paths (.plainva/*, .CONFLICT) are never
   * touched. Shared by the full-listing (missing-from-listing) and incremental (explicit
   * `deleted[]`) deletion paths.
   */
  private async mirrorRemoteDeletion(
    path: string,
    stateMap: Map<string, SyncState>,
    changedPaths: string[]
  ): Promise<void> {
    if (isLocalOnlyPath(path)) return;
    const state = stateMap.get(path) ?? null;
    const localExists = await this.vault.exists(path);
    if (!localExists) {
      await this.stateRepo.deleteSyncState(path);
      return;
    }
    const localSha = isTextFile(path)
      ? await sha256Hash(await this.vault.readTextFile(path))
      : await sha256Bytes(await this.vault.readBinaryFile(path));
    if (state?.base_sha256 && localSha === state.base_sha256) {
      await this.vault.deleteItem(path);
      await this.stateRepo.deleteSyncState(path);
      changedPaths.push(path);
    }
    // else: local has unsynced edits -> keep it.
  }

  /**
   * Reconciles ONE pulled file against local state: download, binary or 3-way text
   * merge (conflict copies on divergence), local write and sync_state advance.
   * Extracted from the cycle loop so a per-file failure can be caught and skipped
   * without aborting the whole pull.
   */
  private async reconcilePulledFile(
    path: string,
    remoteEtag: string,
    state: SyncState | null,
    now: number,
    changedPaths: string[]
  ): Promise<void> {
    // A pending DELETE or RENAME must still short-circuit reconcile: re-downloading
    // and rewriting a file the user is deleting/renaming would resurrect it.
    //
    // A pending WRITE, however, must NOT skip reconcile. The old blanket skip let the
    // subsequent processQueue push the local version straight over a concurrently
    // changed remote — a silent overwrite with no .CONFLICT (the reported data loss).
    // We reconcile the file here instead; the reconciled state (base advanced to the
    // remote) makes the queued write self-cancel in the engine's push guard when
    // local == remote, or carry a clean 3-way merge when it doesn't. A genuinely
    // conflicting remote change is preserved as a .CONFLICT rather than lost. (Merges
    // resolve cleanly for the common single-writer echo case because remote == base.)
    if (await this.queue.hasPendingStructuralOp(path)) {
      console.log(`[SyncWorker] skip reconcile for ${path}: pending delete/rename`);
      return;
    }

    const contentBytes = await this.target.download(path);
    if (!contentBytes) return;

    // Binary files (images, PDFs, …) must never be decoded to text and merged —
    // that corrupts them. Reconcile them byte-wise with conflict-copy on divergence.
    if (!isTextFile(path)) {
      await this.reconcileBinaryFile(path, contentBytes, remoteEtag, state, now, changedPaths);
      return;
    }

    const remoteContent = new TextDecoder().decode(contentBytes);
    const remoteSha = await sha256Hash(remoteContent);

    const localExists = await this.vault.exists(path);
    const localContent = localExists ? await this.vault.readTextFile(path) : null;
    let mergedContent = remoteContent;

    if (localExists && localContent !== null) {
      const localSha = await sha256Hash(localContent);

      if (localSha === remoteSha) {
        mergedContent = remoteContent; // identical content
      } else if (state && state.base_sha256 && localSha === state.base_sha256) {
        mergedContent = remoteContent; // local unchanged since base -> fast-forward
      } else if (state && state.base_sha256) {
        // Both sides changed -> attempt a 3-way merge against the base.
        const baseText = await this.stateRepo.getBaseText(path);
        if (baseText !== null) {
          const mergeRes = mergeText(baseText, localContent, remoteContent);
          if (mergeRes.hasConflicts) {
            const cp = await this.preserveLocalAsConflict(path, localContent);
            changedPaths.push(cp);
            mergedContent = remoteContent; // adopt remote; local kept as .CONFLICT
          } else {
            mergedContent = mergeRes.mergedText;
          }
        } else {
          const cp = await this.preserveLocalAsConflict(path, localContent);
          changedPaths.push(cp);
          mergedContent = remoteContent;
        }
      } else {
        // No reliable base (e.g. first connect) and content diverges. Never
        // silently overwrite the working copy: preserve it as .CONFLICT and
        // adopt remote as canonical local.
        const cp = await this.preserveLocalAsConflict(path, localContent);
        changedPaths.push(cp);
        mergedContent = remoteContent;
      }
    }

    if (!this.isRunning) return;

    // Only rewrite the local file when the reconciled content actually differs
    // from what is on disk. Skipping the no-op write is what stops a just-pushed
    // change (or our own etag flux) from echoing back into the open editor.
    const writeNeeded = !localExists || mergedContent !== localContent;
    // Push when our reconciled content differs from what the remote has.
    const pushMerge = mergedContent !== remoteContent;

    if (writeNeeded) {
      await this.vault.writeTextFile(path, mergedContent);
      changedPaths.push(path);
    }

    const newLocalSha = await sha256Hash(mergedContent);
    await this.stateRepo.updateLocalHashAndBaseText(path, newLocalSha, mergedContent);

    if (pushMerge) {
      // Our reconciled content is ahead of the remote -> enqueue a push so
      // processQueue (below) propagates it this same cycle.
      await this.stateRepo.updateBaseState(path, remoteSha, remoteEtag);
      await this.stateRepo.updateRemoteState(path, remoteEtag, null, now);
      await this.queue.queueWrite(path);
    } else {
      // Fully in sync with the remote version.
      await this.stateRepo.updateRemoteState(path, remoteEtag, null, now);
      await this.stateRepo.updateBaseState(path, remoteSha, remoteEtag);
    }
  }

  public async runCycle() {
    // Paths changed locally by THIS cycle plus the emission cursor for chunked
    // onFilesChanged delivery. Hoisted out of the try so the finally can flush
    // whatever was already written before an abort: sync_state advances per file,
    // so a write this cycle never reports would never be reported again.
    const changedPaths: string[] = [];
    let emittedCount = 0;
    const flushChangedPaths = (force = false) => {
      if (!this.onFilesChanged) return;
      while (
        changedPaths.length - emittedCount >= CHANGED_PATHS_CHUNK ||
        (force && changedPaths.length > emittedCount)
      ) {
        const chunk = changedPaths.slice(emittedCount, emittedCount + CHANGED_PATHS_CHUNK);
        // Advance the cursor BEFORE invoking the consumer: a throwing consumer
        // must not re-consume its chunk on the next flush.
        emittedCount += chunk.length;
        try {
          this.onFilesChanged(chunk);
        } catch (e) {
          console.error("[SyncWorker] onFilesChanged consumer failed:", e);
        }
      }
    };
    // Per-file pull resilience (mirrors the push side's continue-past-poison
    // behavior): one failing download/merge/deletion-mirror skips that file instead
    // of aborting the cycle; an unbroken streak of failing ATTEMPTS aborts (outage
    // heuristic — etag-skips don't touch the streak). Any failure blocks cursor
    // adoption below, so skipped files are re-listed and retried next cycle.
    let pullFailureCount = 0;
    let consecutivePullFailures = 0;
    const guardPullStep = async (path: string, step: () => Promise<void>) => {
      try {
        await step();
        consecutivePullFailures = 0;
      } catch (e) {
        pullFailureCount++;
        consecutivePullFailures++;
        console.error(`[SyncWorker] pull step failed for ${path}:`, e);
        if (consecutivePullFailures >= MAX_CONSECUTIVE_PULL_FAILURES) {
          throw new Error(
            `pull aborted after ${MAX_CONSECUTIVE_PULL_FAILURES} consecutive file failures (${pullFailureCount} failed this cycle): ${e instanceof Error ? e.message : String(e)}`,
            { cause: e }
          );
        }
      }
      flushChangedPaths();
    };
    try {
      console.log("[SyncWorker] cycle start");
      this.setStatus("syncing");

      // 1. Pull the remote change set. Change-token providers (Drive) pull only what
      // changed since the last cursor — a single cheap changes.list instead of walking the
      // whole tree every cycle — with a periodic full listing as a safety net. Every other
      // provider (no getStartCursor) always takes the full-listing path, exactly as before.
      const doFullListing = !this.cursor || this.cyclesSinceFull >= FULL_LISTING_EVERY_N_CYCLES;
      let seededCursor: string | undefined;
      if (doFullListing && this.target.getStartCursor) {
        // Fetch the change token BEFORE the listing so the next incremental pull OVERLAPS
        // the listing (a change landing mid-listing is caught next cycle, never dropped in
        // a gap). The overlap only costs an idempotent re-reconcile.
        try {
          seededCursor = await this.target.getStartCursor();
        } catch (e) {
          console.warn("[SyncWorker] getStartCursor failed; staying on full listings", e);
        }
      }
      const pullResult = doFullListing
        ? await this.target.pull()
        : await this.target.pull(this.cursor);
      const now = Date.now();
      const remotePaths = new Set(pullResult.etagMap.keys());

      // One-query state snapshot for the whole cycle (P2.2): querying per
      // remote file was 10k single SELECT round-trips per no-op tick. Each
      // path is reconciled at most once per cycle, so the snapshot cannot go
      // stale within the loop.
      const stateMap = await this.stateRepo.getAllStates();

      // 2. Reconcile each remote file against local state. Device-local paths
      // (.plainva/*, .CONFLICT copies — e.g. an index DB a desktop client independently
      // mirrored onto the same remote) are never reconciled and must not inflate the
      // progress count either: "Sync x/y" should reflect real vault files, not thousands
      // of mirrored backup snapshots. Count only the reconcilable entries.
      const pullTotal = [...pullResult.etagMap.keys()].filter((p) => !isLocalOnlyPath(p)).length;
      let pullIdx = 0;
      for (const [path, remoteEtag] of pullResult.etagMap.entries()) {
        if (!this.isRunning) break;

        // Never pull device-local state (.plainva/*, .CONFLICT copies): downloading a
        // remote index DB over the live local one corrupts it. See isLocalOnlyPath.
        if (isLocalOnlyPath(path)) continue;
        this.emitProgress("pull", ++pullIdx, pullTotal);

        const state = stateMap.get(path) ?? null;

        // Remote unchanged since our last recorded sync -> nothing to do.
        if (state && state.remote_etag === remoteEtag) continue;

        await guardPullStep(path, () =>
          this.reconcilePulledFile(path, remoteEtag, state, now, changedPaths)
        );
      }

      // 2b. Mirror remote deletions.
      let deletionMirroringSuspended: string | null = null;
      if (this.isRunning && !doFullListing) {
        // INCREMENTAL pull: the provider tells us EXACTLY which files were deleted/trashed
        // (pullResult.deleted). We must NOT infer deletions from "missing from etagMap"
        // here — a cursor pull lists only CHANGED files, so every unchanged file would look
        // "missing" and get destroyed. Act only on the explicit list, with the same
        // per-file safety (never delete a locally-modified file).
        for (const path of pullResult.deleted ?? []) {
          if (!this.isRunning) break;
          // Guarded like reconcile: an explicit deleted[] entry is delivered exactly
          // once per cursor position, so a failed mirror must block cursor adoption
          // below (otherwise the deletion stays unmirrored until the next full listing).
          await guardPullStep(path, () => this.mirrorRemoteDeletion(path, stateMap, changedPaths));
        }
      } else if (this.isRunning && remotePaths.size > 0) {
        // FULL listing: derive deletions from files we confirmed before that are now
        // missing. Only run on a non-empty listing so a transient empty/failed listing can
        // never trigger a mass local delete.
        //
        // KNOWN, INTENTIONAL LIMIT: a genuine "everything deleted remotely" is NOT mirrored
        // — we choose safety (never destroy local data on a broken/empty listing) over
        // completeness.
        const confirmed: Array<{ path: string; state: SyncState }> = [];
        for (const [path, state] of stateMap) {
          if (isLocalOnlyPath(path)) continue;
          if (state.remote_etag) confirmed.push({ path, state });
        }
        const missing = confirmed.filter((c) => !remotePaths.has(c.path));

        // Sanity guard: when an implausibly large share of previously confirmed files
        // vanishes at once, assume a broken/partial listing (truncated response, parser
        // miss, server hiccup) rather than a genuine mass deletion — suspend mirroring and
        // surface a sync error instead of deleting local files.
        if (missing.length > 10 && missing.length > confirmed.length * 0.2) {
          deletionMirroringSuspended = `${missing.length} of ${confirmed.length} previously synced files are missing from the remote listing; deletion mirroring suspended for safety`;
          console.warn(`[SyncWorker] ${deletionMirroringSuspended}`);
        } else {
          for (const { path } of missing) {
            if (!this.isRunning) break;
            await guardPullStep(path, () => this.mirrorRemoteDeletion(path, stateMap, changedPaths));
          }
        }
      }

      if (!this.isRunning) return;

      // Everything pulled so far must be visible before the (potentially long) push
      // phase starts; the finally below only backstops aborts.
      flushChangedPaths(true);

      // 3. Push the local queue (offline writes, renames, deletes, merge results).
      await this.engine.processQueue(
        () => !this.isRunning,
        (current, total) => this.emitProgress("push", current, total)
      );

      console.log(`[SyncWorker] cycle done (${changedPaths.length} local change(s) from remote, ${pullFailureCount} pull failure(s))`);
      this.onProgress?.(null); // clear progress; the cycle's work is done
      this.consecutiveFailures = 0;

      // Advance the incremental-pull state for the NEXT cycle — but ONLY when every
      // pull step succeeded. A skipped file's sync_state did not advance, so replaying
      // the SAME cursor (or, after a full listing, running another full listing because
      // the seeded token was not adopted) re-lists exactly the failed files next cycle;
      // adopting the next token would hide them for up to FULL_LISTING_EVERY_N_CYCLES
      // cycles. (A failure that ABORTS the cycle instead resets the cursor in the catch
      // below.) After a clean full listing, adopt the token we seeded before it
      // (undefined for non-token providers -> stays on full listings); after a clean
      // cursor pull, adopt the follow-up token and count toward the next full pass.
      if (pullFailureCount === 0) {
        if (doFullListing) {
          this.cursor = seededCursor;
          this.cyclesSinceFull = 0;
        } else {
          if (pullResult.nextCursor) this.cursor = pullResult.nextCursor;
          this.cyclesSinceFull++;
        }
      }

      // First fully-clean pull: the remote base is now established for files that exist
      // remotely. Let the host enqueue any genuinely local-only files (deferred after a
      // fresh index so a rebuilt DB never blindly overwrites a newer remote — 3c). Gated
      // on zero pull failures: a file whose reconcile failed has no remote base yet and
      // would be misclassified as local-only, i.e. pushed over a possibly newer remote.
      if (!this.firstCycleComplete && pullFailureCount === 0) {
        this.firstCycleComplete = true;
        try {
          this.onFirstCycleComplete?.();
        } catch (e) {
          console.error("[SyncWorker] onFirstCycleComplete failed:", e);
        }
      }

      if (deletionMirroringSuspended) {
        // Pull/push worked, but the listing looked broken — the user must learn
        // why deletions are not being mirrored (clicking the status opens the
        // sync error dialog). A healthy next cycle clears this automatically.
        this.setStatus("error", deletionMirroringSuspended);
      } else if (pullFailureCount > 0) {
        // The cycle completed, but some files could not be pulled. Surface it (the
        // frozen cursor retries them next cycle) WITHOUT counting toward the
        // consecutive-failure backoff: one permanently poisoned file must not slow
        // down all syncing. A fully clean next cycle clears this automatically.
        this.setStatus("error", `${pullFailureCount} file(s) could not be pulled; they will be retried next cycle`);
      } else {
        this.setStatus("idle");
      }
    } catch (error) {
      this.consecutiveFailures++;
      // Drop the incremental cursor so the NEXT cycle does a full listing. This self-heals
      // an invalidated/expired change token (Drive answers 410 for a stale startPageToken)
      // and re-establishes ground truth after any failure — a full listing always works and
      // re-seeds a fresh cursor. Without this, a bad cursor would fail every cycle forever
      // (the periodic full-listing counter only advances on success). Cost: at most one
      // extra full listing per error recovery.
      this.cursor = undefined;
      console.error("[SyncWorker] cycle error:", error);
      this.onProgress?.(null);
      this.setStatus("error", error instanceof Error ? error.message : String(error));
    } finally {
      // Loss-proofing: report files already written this cycle even when the cycle
      // aborted (error, breaker or stop()) — their sync_state has already advanced,
      // so an unreported write would stay invisible in the app until a restart.
      flushChangedPaths(true);
    }
  }
}
