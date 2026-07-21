import { SyncEngine } from "./SyncEngine.js";
import { ISyncTarget } from "./ISyncTarget.js";
import { SyncStateRepository, SyncState } from "../vault/SyncStateRepository.js";
import { SyncQueue } from "./SyncQueue.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { mergeText } from "../conflict-resolver.js";
import { isTextFile } from "./fileType.js";
import { isSealedBlob } from "../crypto/sealedBlob.js";
import { FatalSyncProtocolError } from "../settingsSync/errors.js";

/**
 * Optional settings-sync hook. `run` is the profile/secrets sideband, executed
 * once per cycle after the file push (it transports `.plainva/sync/*` outside the
 * queue/reconcile path). `guardBeforeCycle` is the fail-closed pre-pull check: it
 * reads the encryption manifest and may throw FatalSyncProtocolError when this
 * device cannot legitimately continue (encrypted remote without a usable key, a
 * key-id switch, an invalid manifest, or a guard-too-old marker), aborting the
 * cycle BEFORE any pull or push (settings-sync plan §3.5, P0 guard).
 */
export interface SettingsSyncRunner {
  guardBeforeCycle?(target: ISyncTarget, vault: IVaultAdapter): Promise<void>;
  run(target: ISyncTarget, vault: IVaultAdapter): Promise<void>;
}

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

/**
 * Drops paths that are covered by another path in the list acting as their
 * folder ancestor (and exact duplicates). A folder deletion enqueues the folder
 * AND one op per contained file; counting the children again inflated the
 * mass-deletion guard's share and tripped it on ordinary folder deletions.
 * O(n · depth) via ancestor-prefix probes against a set.
 */
export function dropCoveredDeletePaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  const set = new Set(unique);
  return unique.filter((p) => {
    let idx = p.lastIndexOf("/");
    while (idx > 0) {
      if (set.has(p.substring(0, idx))) return false;
      idx = p.lastIndexOf("/", idx - 1);
    }
    return true;
  });
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
 * catches remote changes a bare change entry cannot resolve, and runs the
 * authoritative missing-from-listing deletion mirror. At the 15 s default this is a full
 * listing roughly every 5 minutes; every cycle in between is one cheap changes.list call.
 */
const FULL_LISTING_EVERY_N_CYCLES = 20;

/**
 * Wall-clock ceiling between full listings. The cycle counter above assumes
 * uninterrupted foreground polling; on mobile the WebView's timers freeze in
 * the background, so 20 cycles can take hours of calendar time and the
 * safety-net listing practically never came around (maintainer report,
 * 2026-07-16). Measured against real time instead, the first cycle after a
 * long background pause runs a full listing immediately.
 */
const FULL_LISTING_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Stale-cycle watchdog (defense in depth behind the per-request timeouts): a
 * cycle whose awaited work stops making progress — a platform bridge that
 * lost a response, so the fetch promise never settles — would leave
 * `isSyncing` set forever and turn every future trigger into a no-op (the
 * mobile freeze class, 2026-07-16). Progress is measured as cycle ACTIVITY
 * (per-file reconcile steps, progress emissions), not total duration, so a
 * legitimately long first sync never trips it. After WARN ms of inactivity
 * the status surfaces the problem; after ABANDON ms the cycle is written off
 * and the worker frees itself. An abandoned cycle is invalidated via the
 * cycle generation: its remaining loop guards stop at the next boundary and
 * its cleanup no-ops, so it cannot double-schedule against the fresh cycle.
 */
const CYCLE_STALE_WARN_MS = 10 * 60 * 1000;
const CYCLE_STALE_ABANDON_MS = 15 * 60 * 1000;
const WATCHDOG_TICK_MS = 60 * 1000;

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

/**
 * Push-side mass-deletion guard thresholds (mirror of the pull side's
 * missing-from-listing sanity guard). A local mass deletion — the vault folder
 * emptied, moved or its drive unmounted while the app knows the vault — floods
 * the queue with remote DELETEs; executing them would wipe the remote copy.
 * When more than MIN queued deletes ALSO exceed SHARE of the synced baseline,
 * the worker holds all deletes until the user explicitly confirms (or discards)
 * them. Small, plausible deletions are never held.
 */
const MASS_DELETE_MIN = 10;
const MASS_DELETE_SHARE = 0.2;

/**
 * Download prefetch defaults (hardening P3.3). Only the network `download()`
 * is overlapped — write + merge + sync_state + the failure counters stay
 * strictly sequential in listing order, which keeps the WAL single-writer,
 * the breaker semantics and the cursor rules untouched. The BYTE budget
 * (counting actually buffered bytes, so no listing sizes are needed) caps
 * memory when a batch of large attachments arrives; the mobile shell passes
 * smaller values.
 */
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
const DEFAULT_DOWNLOAD_BUFFER_BYTES = 32 * 1024 * 1024;

export interface SyncWorkerOptions {
  downloadConcurrency?: number;
  downloadBufferBytes?: number;
  /**
   * Optional profile-sync sideband (settings-sync plan P1). Run once per cycle
   * after the file push, in its own try/catch so a settings error never affects
   * the file sync. Undefined = feature off.
   */
  settingsSync?: SettingsSyncRunner;
}

/**
 * Overlaps target.download() calls for an ordered list of paths while the
 * caller consumes results strictly in order. New downloads start only while
 * (a) fewer than `concurrency` are in flight AND (b) the bytes already
 * buffered (downloaded but not yet consumed) stay under `maxBufferedBytes`.
 * Failures are delivered on consumption — exactly where the sequential code
 * expects them (guardPullStep).
 */
class DownloadPrefetcher {
  private queueIdx = 0;
  private inFlight = new Map<string, Promise<Uint8Array | null>>();
  private buffered = new Map<string, { bytes: Uint8Array | null } | { error: unknown }>();
  private bufferedBytes = 0;

  constructor(
    private readonly download: (path: string) => Promise<Uint8Array | null>,
    private readonly order: string[],
    private readonly concurrency: number,
    private readonly maxBufferedBytes: number
  ) {
    this.pump();
  }

  private pump(): void {
    while (
      this.queueIdx < this.order.length &&
      this.inFlight.size < this.concurrency &&
      this.bufferedBytes < this.maxBufferedBytes
    ) {
      const path = this.order[this.queueIdx++];
      const p = this.download(path).then(
        (bytes) => {
          this.inFlight.delete(path);
          this.buffered.set(path, { bytes });
          this.bufferedBytes += bytes?.length ?? 0;
          this.pump();
          return bytes;
        },
        (error) => {
          this.inFlight.delete(path);
          this.buffered.set(path, { error });
          this.pump();
          return null;
        }
      );
      this.inFlight.set(path, p);
    }
  }

  /** Consumes the result for `path` (starts an on-demand download if needed). */
  async get(path: string): Promise<Uint8Array | null> {
    if (!this.buffered.has(path) && !this.inFlight.has(path)) {
      // Not part of the prefetch order (or already consumed) — plain download.
      return this.download(path);
    }
    if (this.inFlight.has(path)) await this.inFlight.get(path)!.catch(() => {});
    const entry = this.buffered.get(path);
    this.buffered.delete(path);
    if (entry && "bytes" in entry) {
      this.bufferedBytes -= entry.bytes?.length ?? 0;
      this.pump();
      return entry.bytes;
    }
    this.pump();
    if (entry && "error" in entry) throw entry.error;
    return null;
  }
}

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
   * Fired once when the mass-deletion guard trips (see MASS_DELETE_MIN/SHARE): the
   * queued remote deletions are held and the desktop must ask the user to either
   * approveMassDeletion() (execute them) or discardMassDeletion() (drop the deletes
   * and restore the files from the remote). Re-armed once the condition clears, so
   * a NEW mass deletion later signals again.
   */
  public onMassDeletionPending?: (info: { pendingDeletes: number; syncedTotal: number }) => void;
  /** User approved executing the held deletes; session-scoped, reset when the queue drains. */
  private massDeletionApproved = false;
  /**
   * Path prefixes of deletions the user explicitly confirmed IN the app this
   * session (tree/editor delete dialogs — incl. the second, sharper prompt for
   * large deletions). The mass-deletion guard neither counts nor holds these:
   * the in-app flow already carried its own confirmation. Deliberately
   * session-scoped — deletes still pending after a restart re-trip the guard
   * (destructive intent must not outlive the session).
   */
  private userDeletionPrefixes: string[] = [];
  /** The pending guard state was already signaled to the host (no re-fire every poll). */
  private massDeletionSignaled = false;
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
  /** Wall-clock time of the last successful full listing (see FULL_LISTING_MAX_AGE_MS). */
  private lastFullListingAt = 0;
  /**
   * Monotonic cycle generation. Each executeCycle() claims the next value; the
   * watchdog invalidates a stale cycle by bumping it, which turns the zombie's
   * loop guards false and makes its cleanup a no-op (see CYCLE_STALE_*).
   */
  private activeCycleGen = 0;
  private watchdogId: any;
  private lastCycleActivityAt = 0;
  private staleWarned = false;

  private emitProgress(phase: "pull" | "push", current: number, total: number) {
    this.noteCycleActivity();
    if (!this.onProgress || total <= 0) return;
    const now = Date.now();
    // Always emit the final tick; throttle the rest so no-op polls stay quiet.
    if (current < total && now - this.lastProgressAt < 150) return;
    this.lastProgressAt = now;
    this.onProgress({ phase, current, total });
  }

  /** Marks cycle liveness for the stale-cycle watchdog. */
  private noteCycleActivity() {
    this.lastCycleActivityAt = Date.now();
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
    private readonly intervalMs: number = 60000,
    private readonly options: SyncWorkerOptions = {}
  ) {
    this.settingsSyncRunner = options.settingsSync;
  }

  /** Profile-sync sideband, toggled live when the vault opt-in changes. */
  private settingsSyncRunner?: SettingsSyncRunner;

  /** Enables/disables the profile-sync sideband at runtime (opt-in toggle). */
  public setSettingsSync(runner?: SettingsSyncRunner) {
    this.settingsSyncRunner = runner;
  }

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

  /**
   * Manual "sync now" entry point: unblocks stuck/backed-off queue operations,
   * drops the incremental cursor and syncs immediately with a full listing.
   * A user's explicit sync tap needs all three — a bare trigger neither
   * surfaces brand-new remote files (cursor pulls cannot always resolve them)
   * nor revives pushes parked in manual-intervention after repeated failures,
   * and mobile has no other button that would (2026-07-16).
   */
  public async fullResync(): Promise<void> {
    this.cursor = undefined;
    await this.retryFailed();
  }

  public stop() {
    this.isRunning = false;
    this.disarmWatchdog();
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  /**
   * Executes the held mass deletion: the next cycle pushes the queued remote
   * DELETEs. Session-scoped — still-pending mass deletes trip the guard again
   * after a restart (deliberate: destructive intent must not outlive the session).
   */
  public approveMassDeletion(): void {
    this.massDeletionApproved = true;
    this.triggerImmediate();
  }

  /**
   * Records deletions the user explicitly confirmed in the app (a path acts as
   * a prefix, so one folder entry covers all its children). These bypass the
   * mass-deletion guard's count/hold — see userDeletionPrefixes.
   */
  public noteUserInitiatedDeletion(paths: string[]): void {
    for (const p of paths) {
      const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
      if (norm) this.userDeletionPrefixes.push(norm);
    }
  }

  private isUserInitiatedDeletion(path: string): boolean {
    return this.userDeletionPrefixes.some((pre) => path === pre || path.startsWith(pre + "/"));
  }

  /**
   * Discards the held mass deletion and restores the files from the remote:
   * drops every queued DELETE, clears the paths' sync_state (the reconcile skips
   * paths whose recorded remote_etag still matches — a stale row would block the
   * re-download forever) and forces the next cycle onto a full listing so the
   * files come back immediately instead of at the next periodic full pass.
   */
  public async discardMassDeletion(): Promise<number> {
    const paths = await this.queue.discardPendingDeletes();
    for (const p of paths) {
      await this.stateRepo.deleteSyncState(p);
    }
    this.massDeletionSignaled = false;
    this.cursor = undefined; // full listing next cycle -> immediate restore
    if (paths.length > 0) this.triggerImmediate();
    return paths.length;
  }

  /**
   * Forces the NEXT cycle to run a full listing (dropping the incremental
   * cursor) and triggers it. A user-facing "sync now" should call THIS: a
   * bare cursor cycle lists only CHANGES and defers brand-new remote files
   * to the periodic full listing — on mobile, where the app rarely stays
   * foregrounded for 20 consecutive cycles, that reads as "new files never
   * arrive until an app restart" (maintainer report, Pixel 2026-07-10).
   */
  public triggerFullListing() {
    this.cursor = undefined;
    this.triggerImmediate();
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
    const gen = ++this.activeCycleGen;
    this.armWatchdog(gen);
    const cycle = (async () => {
      try {
        await this.runCycle(gen);
      } finally {
        // A watchdog abandon bumped the generation and already freed the
        // worker — a zombie cycle settling later must not clear the fresh
        // cycle's state or double-schedule.
        if (this.activeCycleGen === gen) {
          this.disarmWatchdog();
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
    })();
    this.currentCycle = cycle;
    try {
      await cycle;
    } finally {
      if (this.currentCycle === cycle) this.currentCycle = null;
    }
  }

  /**
   * Arms the stale-cycle watchdog for cycle `gen` (see CYCLE_STALE_*): warn
   * after prolonged INACTIVITY, then abandon the cycle — reset `isSyncing`,
   * invalidate the zombie via the generation bump and schedule a fresh cycle.
   * With working per-request timeouts this never fires; it exists so a
   * platform bridge that loses a response (the request promise never settles)
   * cannot wedge the worker until an app restart.
   */
  private armWatchdog(gen: number) {
    this.disarmWatchdog();
    this.lastCycleActivityAt = Date.now();
    this.staleWarned = false;
    const tick = () => {
      if (!this.isSyncing || this.activeCycleGen !== gen || !this.isRunning) return;
      const idleMs = Date.now() - this.lastCycleActivityAt;
      if (idleMs >= CYCLE_STALE_ABANDON_MS) {
        console.error(
          `[SyncWorker] abandoning a sync cycle after ${Math.round(idleMs / 60000)} min without activity (a request the platform never answered)`
        );
        this.activeCycleGen++;
        this.isSyncing = false;
        this.pendingSyncRequest = false;
        this.cursor = undefined; // re-establish ground truth on recovery
        this.setStatus("error", "sync cycle was unresponsive and has been abandoned; retrying");
        this.scheduleNext();
        return;
      }
      if (idleMs >= CYCLE_STALE_WARN_MS && !this.staleWarned) {
        this.staleWarned = true;
        console.warn(`[SyncWorker] sync cycle has shown no activity for ${Math.round(idleMs / 60000)} min`);
        this.setStatus("error", "sync cycle appears stuck; it will be abandoned if it stays unresponsive");
      }
      this.watchdogId = setTimeout(tick, WATCHDOG_TICK_MS);
    };
    this.watchdogId = setTimeout(tick, WATCHDOG_TICK_MS);
  }

  private disarmWatchdog() {
    if (this.watchdogId) {
      clearTimeout(this.watchdogId);
      this.watchdogId = undefined;
    }
  }

  /** The in-flight cycle promise, for stopAndDrain (hardening P3.4). */
  private currentCycle: Promise<void> | null = null;

  /**
   * Stops the worker AND waits for a running cycle to finish (hardening
   * P3.4, mobile finding M4): callers that close or delete the database /
   * vault container right after stopping (vault switch, vault delete, app
   * teardown) must not race a cycle that is still downloading or writing.
   * `stop()` alone only prevents FUTURE cycles.
   */
  public async stopAndDrain(): Promise<void> {
    this.stop();
    const cycle = this.currentCycle;
    if (cycle) await cycle.catch(() => {});
  }

  /** Read-only queue snapshot for the settings UI (P3.4 queue visibility). */
  public listPendingOperations(
    limit = 20
  ): Promise<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> }> {
    return this.queue.listAllPending(limit);
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
    // Local hash at read time — the no-write path below only adopts the marker
    // while it is still current (P1 conflict-race; see the guarded repo update).
    let localShaAtRead: string | null = null;

    if (localExists) {
      const localBytes = await this.vault.readBinaryFile(path);
      const localSha = await sha256Bytes(localBytes);
      localShaAtRead = localSha;
      if (localSha === remoteSha) {
        writeNeeded = false; // identical content
      } else if (state?.pending_push_sha && remoteSha === state.pending_push_sha) {
        // Own-push echo (2026-07-16, see reconcilePulledFile): the local bytes
        // are newer unsynced work — keep them, adopt the echoed content as the
        // base and re-queue the local push instead of writing a .CONFLICT.
        console.log(`[SyncWorker] adopting own echoed binary push for ${path} (response was lost)`);
        await this.stateRepo.updateRemoteState(path, remoteEtag, state?.remote_id ?? null, now);
        await this.stateRepo.updateBaseState(path, remoteSha, remoteEtag);
        await this.stateRepo.clearPendingPushSha(path);
        await this.queue.queueWrite(path);
        return;
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
    // When we did NOT rewrite the file, adopt the marker only while no concurrent
    // app save changed it since our read (guarded, P1 conflict-race); after our own
    // write the disk state IS remoteSha and the update stays unconditional.
    if (writeNeeded) {
      await this.stateRepo.updateLocalHash(path, remoteSha);
    } else {
      await this.stateRepo.updateLocalHashGuarded(path, remoteSha, localShaAtRead);
    }
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
    changedPaths: string[],
    download?: () => Promise<Uint8Array | null>
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

    const contentBytes = await (download ? download() : this.target.download(path));
    if (!contentBytes) return;

    // Defensive end-to-end-encryption guard (A3): if the remote bytes are a PVE1
    // sealed blob, another device encrypted this vault and we cannot decrypt.
    // Throw before ANY local write so ciphertext never lands in a file. This is a
    // FatalSyncProtocolError, so guardPullStep rethrows it immediately and ends
    // the whole cycle before the push (no plaintext leaves this device either).
    if (isSealedBlob(contentBytes))
      throw new FatalSyncProtocolError(
        "encrypted-without-key",
        `remote content is end-to-end encrypted and this device cannot decrypt it (${path})`
      );

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
    // Local hash at read time — the no-write path below only adopts the marker
    // while it is still current (P1 conflict-race; see the guarded repo update).
    let localShaAtRead: string | null = null;

    if (localExists && localContent !== null) {
      const localSha = await sha256Hash(localContent);
      localShaAtRead = localSha;

      if (localSha === remoteSha) {
        mergedContent = remoteContent; // identical content
      } else if (state?.pending_push_sha && remoteSha === state.pending_push_sha) {
        // Own-push echo (2026-07-16): the remote content IS the upload whose
        // response we lost (app killed/backgrounded mid-push, timed-out call
        // that the server still committed). The local file already carries
        // NEWER edits typed since then. Merging the echo against the stale
        // base fabricated a .CONFLICT holding the typing-pause snapshot and
        // reset the main file — instead, adopt the echo as the new common
        // ancestor, leave the local file untouched and (re-)queue its push
        // (the original queue op may have been consumed before the kill).
        console.log(`[SyncWorker] adopting own echoed push for ${path} (response was lost)`);
        await this.stateRepo.updateBaseText(path, remoteContent);
        await this.stateRepo.updateBaseState(path, remoteSha, remoteEtag);
        await this.stateRepo.updateRemoteState(path, remoteEtag, state?.remote_id ?? null, now);
        await this.stateRepo.clearPendingPushSha(path);
        await this.queue.queueWrite(path);
        return;
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
    // When we did NOT rewrite the file, adopt the local marker only while no
    // concurrent app save changed it since our read (guarded, P1 conflict-race);
    // base_text still advances unconditionally — the reconciled content IS the
    // new common ancestor. After our own write the update stays unconditional.
    if (writeNeeded) {
      await this.stateRepo.updateLocalHashAndBaseText(path, newLocalSha, mergedContent);
    } else {
      await this.stateRepo.updateLocalHashAndBaseTextGuarded(path, newLocalSha, mergedContent, localShaAtRead);
    }

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

  public async runCycle(gen = this.activeCycleGen) {
    // Cycle liveness: false once the worker stops OR the watchdog abandoned
    // THIS cycle (generation bump). Every loop boundary below checks it, so a
    // zombie cycle whose hung await eventually settles stops writing at the
    // next opportunity instead of racing the fresh cycle.
    const alive = () => this.isRunning && this.activeCycleGen === gen;
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
      this.noteCycleActivity();
      try {
        await step();
        consecutivePullFailures = 0;
      } catch (e) {
        // A protocol violation (encrypted remote we can't read, plaintext in
        // strict mode, key/manifest mismatch) is fatal: never counted as an
        // ordinary single-file failure — rethrow so it ends the whole cycle
        // before the push, fail-closed (settings-sync plan §3.5/A3).
        if (e instanceof FatalSyncProtocolError) throw e;
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

      // 0. Fail-closed protocol guard (opt-in): inspect the encryption manifest
      // before touching data. A FatalSyncProtocolError here ends the cycle in the
      // outer catch (error status + cursor reset) — never a pull, never a push.
      if (this.settingsSyncRunner?.guardBeforeCycle && alive()) {
        await this.settingsSyncRunner.guardBeforeCycle(this.target, this.vault);
      }

      // 1. Pull the remote change set. Change-token providers (Drive) pull only what
      // changed since the last cursor — a single cheap changes.list instead of walking the
      // whole tree every cycle — with a periodic full listing as a safety net. Every other
      // provider (no getStartCursor) always takes the full-listing path, exactly as before.
      const doFullListing =
        !this.cursor ||
        this.cyclesSinceFull >= FULL_LISTING_EVERY_N_CYCLES ||
        // Wall-clock safety net: background pauses freeze the cycle counter,
        // so measure real time too (see FULL_LISTING_MAX_AGE_MS).
        (this.lastFullListingAt > 0 && Date.now() - this.lastFullListingAt >= FULL_LISTING_MAX_AGE_MS);
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

      // Empty-folder sync (2026-07-17): full listings report the remote FOLDER
      // paths; create locally missing ones so an empty remote folder appears
      // without waiting for its first file. Purely additive and best-effort —
      // folder deletions are never derived from this list (folders carry no
      // sync_state), and the raw adapter keeps the creation out of the push
      // queue (no echo mkdir). Desktop trees refresh via the OS watcher, the
      // mobile browser lists the live file system on entry.
      for (const folder of pullResult.folders ?? []) {
        if (!folder || isLocalOnlyPath(folder)) continue;
        try {
          if (!(await this.vault.exists(folder))) {
            await this.vault.createDir(folder);
            console.log(`[SyncWorker] created remote-only empty folder locally: ${folder}`);
          }
        } catch (e) {
          console.warn(`[SyncWorker] could not create remote folder locally: ${folder}`, e);
        }
      }

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
      // Overlap the network downloads for the files this cycle will actually
      // reconcile (P3.3): everything AFTER the download — merge, writes,
      // sync_state, the failure counters — stays strictly sequential below.
      const structuralPending = new Set(await this.queue.getPendingStructuralPaths());
      const reconcileOrder: string[] = [];
      for (const [path, remoteEtag] of pullResult.etagMap.entries()) {
        if (isLocalOnlyPath(path)) continue;
        // No speculative download for a file with a queued delete/rename —
        // reconcile skips those (live-checked below), so downloading would be
        // wasted bandwidth at best and a resurrection vector at worst.
        if (structuralPending.has(path)) continue;
        const s = stateMap.get(path) ?? null;
        if (s && s.remote_etag === remoteEtag) continue;
        reconcileOrder.push(path);
      }
      // Prefer the most-recently-modified remote files first (Drive reports
      // mtimes) so recent edits reconcile — and appear — first.
      if (pullResult.mtimeMap) {
        const m = pullResult.mtimeMap;
        reconcileOrder.sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0));
      }
      const prefetcher = new DownloadPrefetcher(
        (p) => this.target.download(p),
        reconcileOrder,
        Math.max(1, this.options.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY),
        Math.max(1024 * 1024, this.options.downloadBufferBytes ?? DEFAULT_DOWNLOAD_BUFFER_BYTES)
      );
      // Reconcile in the same newest-first order as the prefetch above.
      const pullMtime = pullResult.mtimeMap;
      const pullPaths = pullMtime
        ? [...pullResult.etagMap.keys()].sort((a, b) => (pullMtime.get(b) ?? 0) - (pullMtime.get(a) ?? 0))
        : [...pullResult.etagMap.keys()];
      let pullIdx = 0;
      for (const path of pullPaths) {
        if (!alive()) break;
        const remoteEtag = pullResult.etagMap.get(path)!;

        // Never pull device-local state (.plainva/*, .CONFLICT copies): downloading a
        // remote index DB over the live local one corrupts it. See isLocalOnlyPath.
        if (isLocalOnlyPath(path)) continue;
        this.emitProgress("pull", ++pullIdx, pullTotal);

        const state = stateMap.get(path) ?? null;

        // Remote unchanged since our last recorded sync -> nothing to do.
        if (state && state.remote_etag === remoteEtag) continue;

        await guardPullStep(path, () =>
          this.reconcilePulledFile(path, remoteEtag, state, now, changedPaths, () => prefetcher.get(path))
        );
      }

      // 2b. Mirror remote deletions.
      let deletionMirroringSuspended: string | null = null;
      if (alive() && !doFullListing) {
        // INCREMENTAL pull: the provider tells us EXACTLY which files were deleted/trashed
        // (pullResult.deleted). We must NOT infer deletions from "missing from etagMap"
        // here — a cursor pull lists only CHANGED files, so every unchanged file would look
        // "missing" and get destroyed. Act only on the explicit list, with the same
        // per-file safety (never delete a locally-modified file).
        for (const path of pullResult.deleted ?? []) {
          if (!alive()) break;
          // Guarded like reconcile: an explicit deleted[] entry is delivered exactly
          // once per cursor position, so a failed mirror must block cursor adoption
          // below (otherwise the deletion stays unmirrored until the next full listing).
          await guardPullStep(path, () => this.mirrorRemoteDeletion(path, stateMap, changedPaths));
        }
      } else if (alive() && remotePaths.size > 0) {
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
            if (!alive()) break;
            await guardPullStep(path, () => this.mirrorRemoteDeletion(path, stateMap, changedPaths));
          }
        }
      }

      if (!alive()) return;

      // Everything pulled so far must be visible before the (potentially long) push
      // phase starts; the finally below only backstops aborts.
      flushChangedPaths(true);

      // Push-side mass-deletion guard (mirror of the pull side's sanity guard): a
      // local mass deletion — the vault folder emptied, moved or unmounted while the
      // app knows the vault — floods the queue with remote DELETEs, and executing
      // them would wipe the remote copy. Hold ALL deletes (writes/renames proceed)
      // until the user explicitly approves or discards them; signal the host once.
      let deletionsHeld: string | null = null;
      const pendingDeletePaths = await this.queue.getPendingDeletePaths();
      const syncedTotal = [...stateMap.keys()].filter((p) => !isLocalOnlyPath(p)).length;
      // Only UNEXPLAINED deletions count towards the guard: paths the user
      // explicitly confirmed in the app carry their own confirmation (incl. the
      // second prompt for large deletions), and children covered by a queued
      // ancestor folder delete must not inflate the share — both used to trip
      // the guard on an ordinary, deliberate folder deletion, whose "restore"
      // answer then resurrected the folder from the cloud.
      const unexplainedDeletes = dropCoveredDeletePaths(
        pendingDeletePaths.filter((p) => !this.isUserInitiatedDeletion(p))
      );
      const isMassDeletion =
        unexplainedDeletes.length > MASS_DELETE_MIN &&
        unexplainedDeletes.length > syncedTotal * MASS_DELETE_SHARE;
      if (isMassDeletion && !this.massDeletionApproved) {
        deletionsHeld = `${pendingDeletePaths.length} of ${syncedTotal} synced files are queued for remote deletion; deletions are paused until confirmed`;
        console.warn(`[SyncWorker] ${deletionsHeld}`);
        if (!this.massDeletionSignaled) {
          this.massDeletionSignaled = true;
          try {
            this.onMassDeletionPending?.({ pendingDeletes: pendingDeletePaths.length, syncedTotal });
          } catch (e) {
            console.error("[SyncWorker] onMassDeletionPending consumer failed:", e);
          }
        }
      } else if (!isMassDeletion) {
        // Condition cleared (deletes executed or discarded): re-arm the guard.
        this.massDeletionApproved = false;
        this.massDeletionSignaled = false;
      }

      // 3. Push the local queue (offline writes, renames, deletes, merge results).
      await this.engine.processQueue(
        () => !alive(),
        (current, total) => this.emitProgress("push", current, total),
        { skipDeletes: deletionsHeld !== null }
      );

      // 4. Profile-sync sideband (opt-in): transport `.plainva/sync/settings.json`
      // directly, outside the queue/reconcile path. Its own try/catch so a
      // settings hiccup never fails or slows the file sync.
      if (this.settingsSyncRunner && alive()) {
        try {
          await this.settingsSyncRunner.run(this.target, this.vault);
        } catch (e) {
          console.error("[SyncWorker] settings-sync sideband failed:", e);
        }
      }

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
          this.lastFullListingAt = Date.now();
        } else {
          if (pullResult.nextCursor) this.cursor = pullResult.nextCursor;
          this.cyclesSinceFull++;
        }
      }

      // The cursor pull saw changes it could not resolve on its own (a brand-new
      // file in an unknown folder, a remote folder rename/move/trash): drop the
      // cursor and follow up with a full listing right away instead of leaving
      // the change invisible until the periodic safety net.
      if (!doFullListing && pullResult.needsFullListing) {
        console.log("[SyncWorker] cursor pull could not resolve every change; scheduling a full listing");
        this.cursor = undefined;
        this.pendingSyncRequest = true;
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

      if (deletionsHeld) {
        // The user has a pending decision (execute or discard the held remote
        // deletions); keep the error status visible until it is made.
        this.setStatus("error", deletionsHeld);
      } else if (deletionMirroringSuspended) {
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
