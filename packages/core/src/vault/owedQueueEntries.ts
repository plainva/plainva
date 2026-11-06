/**
 * The entries a sync queue still owes for changes that are on disk already —
 * shared by the vault's chain (`QueueingVaultAdapter`, the sync queue) and the
 * encrypted workspace's (`WorkspaceQueueingVaultAdapter`, its signed queue).
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
 * note nobody else had touched (finding 2026-10-12).
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
 *
 * Writing an entry again after a failure must be safe: the write that failed
 * may have reached the database before its answer was lost. The sync queue
 * takes the same entry twice as one (its writes coalesce, its structural
 * entries are refused a second time by nothing that matters — the sync reads
 * the disk), and the encrypted workspace's `enqueue` is idempotent (D2).
 *
 * While an entry is owed, the sync must already know of it (Datensicherheit
 * D4): a deletion or a rename that waits here is in no table yet, and a pull
 * that does not know of it brings the file back from the remote.
 * `hasOwedStructuralOp` and `hasOwedEntryFor` answer for it.
 */

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

export interface OwedQueueEntriesOptions {
  /** Told when an entry that failed at first is written after all, or given up. */
  onEntry?: (report: QueueEntryReport) => void;
  /** When, after its change, an entry that failed is tried again; an entry that comes along tries it at once besides. */
  retryAtMs?: readonly number[];
  /** How long after its change an entry that still fails is given up. */
  giveUpAfterMs?: number;
  /** The clock that time is measured with. */
  now?: () => number;
}

/**
 * What an owed entry is about: the paths of the change — for a deletion every
 * path it takes away (a folder and the files below it), for a rename its
 * source — and, for a rename, where it goes.
 */
export interface OwedEntryScope {
  kind: QueueEntryKind;
  paths: readonly string[];
  newPath?: string | null;
}

/** What the sync asks of the entries owed for changes on disk (D4). */
export interface OwedStructure {
  /** A deletion or rename of `path`, of a folder it lies in, or (for a rename) to it, is owed. */
  hasOwedStructuralOp(path: string): boolean;
  /** The paths of every deletion and rename owed, both ends of a rename included. */
  owedStructuralPaths(): string[];
  /** Any entry owed whose change touches exactly `path` (as a source or a rename's destination). */
  hasOwedEntryFor(path: string): boolean;
  /** Every path an owed entry touches, both ends of a rename included. */
  owedPaths(): string[];
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

interface OwedEntry extends OwedEntryScope {
  write: () => Promise<void>;
  /** When the change was on disk: the times above are measured from here. */
  since: number;
  /** Attempts so far, the first one included. */
  attempts: number;
  /** The caller's write, which waits for this entry. */
  done: () => void;
  failed: (error: unknown) => void;
}

const within = (parent: string, path: string): boolean => path === parent || path.startsWith(parent + "/");
const structural = (kind: QueueEntryKind): boolean => kind === "delete" || kind === "rename";

export class OwedQueueEntries implements OwedStructure {
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

  constructor(private readonly options: OwedQueueEntriesOptions = {}) {
    this.retryAtMs = options.retryAtMs?.length ? options.retryAtMs : RETRY_AT_MS;
    this.giveUpAfterMs = options.giveUpAfterMs ?? GIVE_UP_AFTER_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Writes the entry for a change that is on disk, now or — after a failure —
   * on the schedule above; resolves once it is in the queue, rejects once it
   * is given up.
   */
  enqueue(scope: OwedEntryScope, write: () => Promise<void>): Promise<void> {
    return new Promise<void>((done, failed) => {
      this.owed.push({ kind: scope.kind, paths: [...scope.paths], newPath: scope.newPath ?? null, write, since: this.now(), attempts: 0, done, failed });
      void this.passAfterRunning();
    });
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

  hasOwedStructuralOp(path: string): boolean {
    return this.owed.some((entry) => structural(entry.kind) && (
      entry.paths.some((p) => within(p, path)) || (!!entry.newPath && within(entry.newPath, path))
    ));
  }

  owedStructuralPaths(): string[] {
    return this.owed.filter((entry) => structural(entry.kind)).flatMap((entry) => entry.newPath ? [...entry.paths, entry.newPath] : [...entry.paths]);
  }

  hasOwedEntryFor(path: string): boolean {
    return this.owed.some((entry) => entry.paths.includes(path) || entry.newPath === path);
  }

  owedPaths(): string[] {
    return this.owed.flatMap((entry) => entry.newPath ? [...entry.paths, entry.newPath] : [...entry.paths]);
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
        console.warn(`[OwedQueueEntries] a ${entry.kind} entry of the sync queue is given up after ${entry.attempts} attempt(s)`, error);
        this.report({ outcome: "lost", kind: entry.kind, attempts: entry.attempts, error });
        continue;
      }
      this.owed.shift();
      this.clearRetry();
      this.failing = false;
      entry.done();
      if (entry.attempts > 1) this.report({ outcome: "made-up", kind: entry.kind, attempts: entry.attempts });
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
      console.warn("[OwedQueueEntries] a report about a queue entry failed", error);
    }
  }
}
