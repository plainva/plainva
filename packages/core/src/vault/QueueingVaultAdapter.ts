import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo } from "./IVaultAdapter.js";
import { SyncQueue } from "../sync/SyncQueue.js";
import { isSystemJunkPath } from "./systemJunk.js";

/**
 * Device-local paths that must never be enqueued for push: `.plainva/` (the SQLite index,
 * graph pins, bookmarks) and `.CONFLICT-<ts>` copies (local conflict snapshots the user
 * resolves locally). The push targets already refuse `.CONFLICT`, but keeping them out of
 * the queue entirely avoids no-op queue rows and matches the pull side (`isLocalOnlyPath`).
 * Operating-system bookkeeping (`.DS_Store`, …; issue #110, E10) never travels either —
 * an import may copy it into the vault, and deleting it here deletes nothing remotely.
 */
function isLocalOnly(path: string): boolean {
  return path.startsWith(".plainva") || path.includes(".CONFLICT") || isSystemJunkPath(path);
}

function notifyQueued(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-sync-queued"));
  } catch (error) {
    console.warn("[QueueingVaultAdapter] telling the shell of a new entry failed", error);
  }
}

/** Which entry the sync queue was to get — all a report about it says; never a path. */
export type QueueEntryKind = "write" | "delete" | "rename" | "mkdir";

/** What became of an entry that could not be written at the first attempt. */
export type QueueEntryReport =
  | { outcome: "made-up"; kind: QueueEntryKind; attempts: number }
  | { outcome: "lost"; kind: QueueEntryKind; attempts: number; error: unknown };

/**
 * One line for the diagnostics export, the same in both shells: the kind of
 * entry, how often it was tried, and for one given up the database's words —
 * never a path.
 */
export function formatQueueEntryReport(report: QueueEntryReport): string {
  const attempts = `${report.attempts} attempt${report.attempts === 1 ? "" : "s"}`;
  if (report.outcome === "made-up") {
    return `a ${report.kind} entry of the sync queue was written after ${attempts} — it had failed after the change was on disk`;
  }
  const why = report.error instanceof Error ? report.error.message : String(report.error);
  return `a ${report.kind} entry of the sync queue could not be written (${attempts}: ${why}) — the change is on disk, and its write was reported as failed`;
}

export interface QueueingVaultAdapterOptions {
  /** Told when an entry that failed at first is written after all, or given up. */
  onEntry?: (report: QueueEntryReport) => void;
  /** When, after its change, an entry that failed is tried again; an entry that comes along tries it at once besides. */
  retryAtMs?: readonly number[];
  /** How long after its change an entry that still fails is given up. */
  giveUpAfterMs?: number;
  /** The clock that time is measured with. */
  now?: () => number;
}

const RETRY_AT_MS: readonly number[] = [250, 1_250, 5_250, 15_250, 30_250];
/**
 * How long after its change an entry that still fails is given up, and its
 * write fails — the waiting for the database included (finding 2026-10-19,
 * from the reviews of the change). Long enough to wait out a lock another
 * connection holds: the desktop's pool answers a lock only after it has
 * waited five seconds itself, so its first failure comes five seconds after
 * the change and the next attempt at 5.25 s. A floating window of the desktop
 * gives the main window 15 seconds for a write (`RPC_TIMEOUT_MS` in the
 * desktop's `windowBus.ts`); a write that takes longer is reported there as
 * failed and lands all the same — as one did before this change that waited
 * for the lock in front of the pool while a full scan held it.
 */
const GIVE_UP_AFTER_MS = 30_000;
/** How long `flush` waits for the entries before the shell closes the database anyway. */
const FLUSH_WAITS_MS = 10_000;

interface OwedEntry {
  kind: QueueEntryKind;
  write: () => Promise<void>;
  /** When the change was on disk: the times above are measured from here. */
  since: number;
  /** Attempts so far, the first one included. */
  attempts: number;
  /** The caller's write, which waits for this entry. */
  done: () => void;
  failed: (error: unknown) => void;
}

export class QueueingVaultAdapter implements IVaultAdapter {
  /** Entries whose change is on disk and that are not in the queue yet, the oldest first; each one's write waits for it. */
  private readonly owed: OwedEntry[] = [];
  private pass: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by `flush`: from then on an entry gets one attempt and no wait. */
  private closing = false;
  /**
   * An entry was given up, and none has been written since: the database
   * keeps failing. Until one is written, an entry that fails is given up at
   * its first failure — a loop of writes (a move of many files, an import)
   * then fails as fast as the database answers (the desktop's pool after its
   * five seconds of waiting for a lock) instead of waiting the full time for
   * each one.
   */
  private failing = false;
  private readonly retryAtMs: readonly number[];
  private readonly giveUpAfterMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncQueue: SyncQueue,
    private readonly options: QueueingVaultAdapterOptions = {}
  ) {
    this.retryAtMs = options.retryAtMs?.length ? options.retryAtMs : RETRY_AT_MS;
    this.giveUpAfterMs = options.giveUpAfterMs ?? GIVE_UP_AFTER_MS;
    this.now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async dispose(): Promise<void> {
    await this.flush();
    return this.inner.dispose();
  }

  /**
   * One last attempt for every entry still owed, while the vault's database
   * is open (finding 2026-10-19): an entry waiting for its next attempt is not
   * a transaction the database could wait for. The phone's vault calls this
   * before it closes its database; the desktop does not close its database
   * when a vault closes. What fails now is given up and its write fails; from
   * now on an entry gets one attempt and no wait. It waits at most ten
   * seconds, and an entry still under way then settles once its attempt does;
   * the phone's `close` then waits up to ten more for the transactions asked
   * for before it.
   */
  async flush(): Promise<void> {
    this.closing = true;
    this.clearRetry();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.passAfterRunning(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, FLUSH_WAITS_MS); }),
    ]);
    clearTimeout(timer);
  }

  async readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.inner.writeTextFile(path, content);
    if (!isLocalOnly(path)) {
      console.log(`[QueueingVaultAdapter] queue write ${path}`);
      await this.enqueue("write", () => this.syncQueue.queueWrite(path));
    }
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.inner.writeBinaryFile(path, content);
    if (!isLocalOnly(path)) {
      console.log(`[QueueingVaultAdapter] queue write (binary) ${path}`);
      await this.enqueue("write", () => this.syncQueue.queueWrite(path));
    }
  }

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    let childFiles: string[] = [];
    if (!isLocalOnly(path)) {
      // A failed/incomplete walk cannot justify a confirmed folder deletion.
      // The reporting contract survives every adapter in both shell chains.
      const info = await this.inner.getFileInfo(path);
      if (info.isDirectory && recursive) {
        const report = await this.listDirReport(path, true);
        if (report.skipped.length) throw new Error("Cannot delete folder: some entries could not be read");
        childFiles = report.files.filter((e) => !e.isDirectory && !isLocalOnly(e.path)).map((e) => e.path);
      }
    }
    await this.inner.deleteItem(path, recursive, confirmation);
    if (!isLocalOnly(path)) {
      await this.enqueue("delete", () => this.syncQueue.queueDeletePaths([path, ...childFiles], confirmation));
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.inner.renameItem(oldPath, newPath);
    if (!isLocalOnly(oldPath) && !isLocalOnly(newPath)) {
      await this.enqueue("rename", () => this.syncQueue.queueRename(oldPath, newPath));
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  /** The spelling the path is stored under on disk (path identity, ADR 0016). */
  async realPath(path: string): Promise<string> {
    return this.inner.realPath ? this.inner.realPath(path) : path;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.inner.getFileInfo(path);
  }

  /**
   * Optional on the underlying adapter: forwarded when it is there, a no-op
   * when it is not. The import writer stamps a note's source dates through
   * here, and it is only reachable via the wrappers the app actually hands
   * out — a wrapper that swallowed the call would make the whole feature a
   * silent no-op in the real app while every test still passed.
   */
  async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void> {
    await (this.inner as any).setFileTimes?.(path, times);
  }

  async listDirReport(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultListing> {
    return this.inner.listDirReport
      ? this.inner.listDirReport(path, recursive, options)
      : { files: await this.inner.listDir(path, recursive, options), skipped: [] };
  }

  async listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return this.inner.listDir(path, recursive, options);
  }

  async createDir(path: string): Promise<void> {
    await this.inner.createDir(path);
    // Empty folders sync too (2026-07-17): an in-app folder creation reaches
    // the cloud right away instead of materializing with its first file.
    if (!isLocalOnly(path)) {
      await this.enqueue("mkdir", () => this.syncQueue.queueMkdir(path));
    }
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }

  /**
   * The entry in the sync queue for a change that is on disk already
   * (finding 2026-10-12).
   *
   * The disk comes first, the entry second — in that order a failure on the
   * way leaves something not yet announced, never an announced change that
   * did not happen (a deletion queued for a file that is still there). But an
   * entry that failed used to fail the WRITE at once. On the phone, whose
   * database refused a second transaction while one was open, that was any
   * write meeting the sync or the index at work: its caller was told the
   * change had not happened while it was on disk, the chain above did not
   * take note of its own write — the next write of that file met a disk it
   * did not know, and an editor that typed on ended in a conflict copy of a
   * note nobody else had touched.
   *
   * So an entry that fails is made up for, and its write waits for it: it is
   * tried again a quarter of a second and 1.25, 5.25, 15.25 and 30.25 seconds
   * after its change, and at once whenever a later entry comes along. Entries
   * are written in the order their changes happened — one that waits holds
   * back the ones after it, for a write queued after the rename of its file is
   * not one queued before it. The write returns once its entry is in the
   * queue.
   *
   * An entry that still fails 30 seconds after its change — the waiting for
   * the database counts — is given up, and then its write fails, as every
   * failed entry's did before; while the database keeps failing (`failing`),
   * the next ones are given up at their first failure. That keeps the net the
   * index has always been (finding 2026-10-19, from the review of this
   * change): the chain above takes no note of a write that failed, so a later
   * index pass finds the file differing from what the chain knows and
   * announces it — a changed file as a change, a deletion as an unconfirmed
   * one, a new folder not at all, and a rename as what the index saw of it
   * meanwhile: a deletion and a new file, or, where a shell let the rename
   * pass because the file landed, a new file next to the old one. A write
   * that returned while its entry was still owed would have been taken note
   * of, and an entry lost after that — given up, or the app ending first —
   * would never have been announced by anybody.
   */
  private enqueue(kind: QueueEntryKind, write: () => Promise<void>): Promise<void> {
    return new Promise<void>((done, failed) => {
      this.owed.push({ kind, write, since: this.now(), attempts: 0, done, failed });
      void this.passAfterRunning();
    });
  }

  /**
   * A pass that begins after the one under way, if any: that one may be past
   * its last look at the row, and what was added since needs a look.
   */
  private async passAfterRunning(): Promise<void> {
    const running = this.pass;
    if (running) await running;
    await this.writeOwed();
  }

  /** One pass over the owed entries, oldest first; it stops at the first that fails in time. Never rejects. */
  private writeOwed(): Promise<void> {
    if (!this.pass) {
      const pass = this.writeInOrder().finally(() => {
        if (this.pass === pass) this.pass = null;
      });
      this.pass = pass;
    }
    return this.pass;
  }

  private async writeInOrder(): Promise<void> {
    while (this.owed.length > 0) {
      const entry = this.owed[0];
      entry.attempts += 1;
      try {
        await entry.write();
      } catch (error) {
        if (!this.closing && !this.failing && this.now() - entry.since < this.giveUpAfterMs) {
          this.retryAfter(entry);
          return;
        }
        this.owed.shift();
        // The next entry fails on its own schedule, not on the wait armed for this one.
        this.clearRetry();
        this.failing = true;
        entry.failed(error);
        console.warn(`[QueueingVaultAdapter] a ${entry.kind} entry of the sync queue is given up after ${entry.attempts} attempt(s)`, error);
        this.report({ outcome: "lost", kind: entry.kind, attempts: entry.attempts, error });
        continue;
      }
      this.owed.shift();
      this.clearRetry();
      this.failing = false;
      entry.done();
      if (entry.attempts > 1) this.report({ outcome: "made-up", kind: entry.kind, attempts: entry.attempts });
      notifyQueued();
    }
  }

  /**
   * Arms the next attempt of the first entry at its next time after the
   * change — attempts a later entry set off do not move the times —, unless
   * one is armed already. Past the last time (a give-up later than that) the
   * last interval repeats.
   */
  private retryAfter(entry: OwedEntry): void {
    if (this.closing || this.retryTimer !== null) return;
    const elapsed = this.now() - entry.since;
    const next = this.retryAtMs.find((at) => at > elapsed);
    const last = this.retryAtMs[this.retryAtMs.length - 1];
    const interval = last - (this.retryAtMs[this.retryAtMs.length - 2] ?? 0);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.passAfterRunning();
    }, next !== undefined ? next - elapsed : interval);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private report(report: QueueEntryReport): void {
    try {
      this.options.onEntry?.(report);
    } catch (error) {
      console.warn("[QueueingVaultAdapter] a report about a queue entry failed", error);
    }
  }
}
