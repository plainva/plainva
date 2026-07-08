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

export type SyncStatus = "idle" | "syncing" | "error";

/** Upper bound for the adaptive pull backoff (a failing server is retried at most this slowly). */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class SyncWorker {
  private timeoutId: any;
  private isRunning = false;
  private isSyncing = false;
  private pendingSyncRequest = false;
  public onStatusChange?: (status: SyncStatus, error?: string) => void;
  /**
   * Fired after a cycle that changed local files (pulled writes, conflict files
   * or mirrored deletions). The desktop wires this to a re-index + file-tree
   * refresh so pulled changes become visible deterministically, independent of
   * OS filesystem-watch reliability.
   */
  public onFilesChanged?: (paths: string[]) => void;
  private currentStatus: SyncStatus = "idle";
  /** Consecutive failed cycles; drives the adaptive pull backoff (reset on success). */
  private consecutiveFailures = 0;

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

  public async runCycle() {
    try {
      console.log("[SyncWorker] cycle start");
      this.setStatus("syncing");
      const changedPaths: string[] = [];

      // 1. Pull remote listing.
      const pullResult = await this.target.pull();
      const now = Date.now();
      const remotePaths = new Set(pullResult.etagMap.keys());

      // One-query state snapshot for the whole cycle (P2.2): querying per
      // remote file was 10k single SELECT round-trips per no-op tick. Each
      // path is reconciled at most once per cycle, so the snapshot cannot go
      // stale within the loop.
      const stateMap = await this.stateRepo.getAllStates();

      // 2. Reconcile each remote file against local state.
      for (const [path, remoteEtag] of pullResult.etagMap.entries()) {
        if (!this.isRunning) break;

        const state = stateMap.get(path) ?? null;

        // Remote unchanged since our last recorded sync -> nothing to do.
        if (state && state.remote_etag === remoteEtag) continue;

        // Skip files with an unpushed local change: reconciling a freshly-edited file
        // against a (possibly stale) base is the dominant source of spurious .CONFLICT
        // files during active editing (e.g. a .base file being edited in the database
        // viewer). Let processQueue push the local version this cycle; the next cycle
        // reconciles cleanly once local == remote. Trade-off: a genuine *concurrent*
        // remote change is overwritten by the local version rather than preserved as a
        // .CONFLICT. That is acceptable for the single-writer case this targets; true
        // multi-device merge remains a post-MVP concern.
        if (await this.queue.hasPendingOperation(path)) {
          console.log(`[SyncWorker] skip reconcile for ${path}: local change pending push`);
          continue;
        }

        const contentBytes = await this.target.download(path);
        if (!contentBytes) continue;

        // Binary files (images, PDFs, …) must never be decoded to text and merged —
        // that corrupts them. Reconcile them byte-wise with conflict-copy on divergence.
        if (!isTextFile(path)) {
          await this.reconcileBinaryFile(path, contentBytes, remoteEtag, state, now, changedPaths);
          continue;
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

        if (!this.isRunning) break;

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

      // 2b. Mirror remote deletions. Only run when the listing is non-empty, so a
      // transient empty/failed PROPFIND can never trigger a mass local delete.
      //
      // KNOWN, INTENTIONAL LIMIT: this means a genuine "everything was deleted on the
      // remote" is NOT mirrored locally — we choose safety (never destroy local data on a
      // broken/empty listing) over completeness. A future hardening could distinguish the
      // two with a two-cycle confirmation or a provider-authoritative empty-state signal.
      let deletionMirroringSuspended: string | null = null;
      if (this.isRunning && remotePaths.size > 0) {
        // Only mirror deletions for files we actually confirmed on the remote
        // before; skip purely local-ahead files that were never pushed.
        const confirmed: Array<{ path: string; state: SyncState }> = [];
        for (const [path, state] of stateMap) {
          if (path.includes(".CONFLICT")) continue;
          if (state.remote_etag) confirmed.push({ path, state });
        }
        const missing = confirmed.filter((c) => !remotePaths.has(c.path));

        // Sanity guard: when an implausibly large share of previously confirmed
        // files vanishes from the listing at once, assume a broken/partial
        // listing (truncated response, parser miss, server hiccup) rather than a
        // genuine mass deletion — suspend mirroring for this cycle and surface
        // it as a sync error instead of deleting local files.
        if (missing.length > 10 && missing.length > confirmed.length * 0.2) {
          deletionMirroringSuspended = `${missing.length} of ${confirmed.length} previously synced files are missing from the remote listing; deletion mirroring suspended for safety`;
          console.warn(`[SyncWorker] ${deletionMirroringSuspended}`);
        } else {
          for (const { path, state } of missing) {
            if (!this.isRunning) break;

            const localExists = await this.vault.exists(path);
            if (!localExists) {
              await this.stateRepo.deleteSyncState(path);
              continue;
            }

            const localContent = await this.vault.readTextFile(path);
            const localSha = await sha256Hash(localContent);
            if (state.base_sha256 && localSha === state.base_sha256) {
              // Local unchanged since last sync -> safe to mirror the deletion.
              await this.vault.deleteItem(path);
              await this.stateRepo.deleteSyncState(path);
              changedPaths.push(path);
            }
            // Otherwise local has unsynced edits: keep the file and let it surface
            // as a local-ahead change rather than destroying the user's work.
          }
        }
      }

      if (!this.isRunning) return;

      // 3. Push the local queue (offline writes, renames, deletes, merge results).
      await this.engine.processQueue(() => !this.isRunning);

      if (changedPaths.length > 0 && this.onFilesChanged) {
        this.onFilesChanged(changedPaths);
      }

      console.log(`[SyncWorker] cycle done (${changedPaths.length} local change(s) from remote)`);
      this.consecutiveFailures = 0;
      if (deletionMirroringSuspended) {
        // Pull/push worked, but the listing looked broken — the user must learn
        // why deletions are not being mirrored (clicking the status opens the
        // sync error dialog). A healthy next cycle clears this automatically.
        this.setStatus("error", deletionMirroringSuspended);
      } else {
        this.setStatus("idle");
      }
    } catch (error) {
      this.consecutiveFailures++;
      console.error("[SyncWorker] cycle error:", error);
      this.setStatus("error", error instanceof Error ? error.message : String(error));
    }
  }
}
