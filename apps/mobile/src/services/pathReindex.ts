import type { IVaultAdapter, VaultFileInfo, VaultIndexer } from "@plainva/core";

/**
 * How the phone's index follows the files, one path at a time (finding
 * 2026-10-09).
 *
 * The desktop has a watcher: whatever wrote a file, a moment later the index
 * looks at it, whatever its kind. The phone has none (parity catalog,
 * `external-change-watcher`) — between two full scans its index knows what
 * the app tells it. It was told about notes only: the one call every writer
 * and the sync made took `.md` and did nothing for the rest, without a word.
 * A database saved on the phone, a table or a settings file a pull brought,
 * a restored file: on disk, synced, and unknown to the index until the next
 * full scan — which then took the file's sync row for the leftover of a
 * deleted file and wrote the file's current text over its merge base. A
 * change made on the phone in between, and one made on another device, and
 * the phone's was gone at the next sync without a conflict copy.
 *
 * A path a pull REMOVED fared no better: a file that is gone could not be
 * read and was skipped, so its row stayed — in search, in every list drawn
 * from the index. The worker's "that deletion was mine" (`OwnDeletionRegister`)
 * lives in memory, for an hour; a full scan that reported the file vanished
 * after that, or after a restart, queued a remote deletion for it.
 *
 * So every path somebody wrote, moved here or removed goes through this one
 * door, whatever kind of file it is:
 *  - A file that is there is indexed as it lies there, without asking its
 *    timestamp first. The caller KNOWS it changed; a storage provider that
 *    rounds its timestamps, or reports none, must not talk the index out of
 *    it.
 *  - A path that is gone leaves the index through the core's own removal — in
 *    a transaction of its own — which then tells the shell
 *    (`onLocalFileDeleted`), and a full scan under way that misses the same
 *    file says nothing more (`VaultIndexer.stillMine`). What the plain sync
 *    worker removed is answered there while its mark is still fresh; the
 *    worker of an encrypted workspace leaves no mark on the phone, and its
 *    removals go on to the workspace's authorization as they did when the
 *    next full scan reported them.
 *    Only "it is not there" counts as gone: a read that failed for any other
 *    reason proves nothing, and a deletion is never concluded from it.
 *  - A path that could not be followed is tried once more, as the desktop's
 *    index queue does; what fails twice is left to the next full scan and
 *    counted for the diagnostics instead of vanishing. A file that is there
 *    waits a moment for its second attempt — the door must not hang on a
 *    scan. A removal waits for the full scan under way first: the worker's
 *    mark lives in memory, for an hour, and a removal the next full scan has
 *    to report meets it only in this run of the app. No merge base depends on
 *    who gets there first any more (`VaultIndexer.judgeSyncState`).
 */

/**
 * One at a time on the phone's index database.
 *
 * That database is a single connection, and a second transaction cannot open
 * while one is open (`CapacitorSqliteAdapter.transaction`: Android answers
 * "Already in transaction", SQLite on iOS refuses the second BEGIN). Left to
 * itself the index meets itself there in two ways. The batches of a long pull
 * are handed over without waiting for one another, and two of them indexing
 * side by side refuse each other's files. And a pass announces what it found
 * — a new file to upload, a vanished one to delete remotely — to hooks that
 * open a transaction of their own without waiting: the next path's pass runs
 * into it, and of several files one pass announces, only the first is queued.
 *
 * So a pass over a path and what a pass sets off each take a turn here, in the
 * order they were asked for. A batch asks for its next path only when the one
 * before is through, so a save that arrives in the middle of a pull waits for
 * the turns already asked for — the path each batch has in flight and what
 * those passes set off — not for the batches.
 *
 * Whoever else opens a transaction on this database is not in the row: a full
 * scan, a folder that is re-read, the app's own move in the index, the look at
 * a note opened in an external folder, every save's entry in the sync queue,
 * the sync worker's queue, the calendar cache. A pass that meets one of them
 * is refused, and that is what the second attempt is for. A full scan that
 * found something to write holds its transaction until it is through; a file
 * the index is told of meanwhile is refused at both attempts — its caller has
 * waited some 400 ms by then — and is left to the next full scan. (A save
 * rarely gets that far while a scan writes: its own entry in the sync queue
 * is refused first.)
 */
export interface IndexTurns {
  take<T>(work: () => Promise<T>): Promise<T>;
}

export function createIndexTurns(): IndexTurns {
  let last: Promise<unknown> = Promise.resolve();
  return {
    take<T>(work: () => Promise<T>): Promise<T> {
      const turn = last.then(work);
      last = turn.catch(() => {});
      return turn;
    },
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AnnouncerOptions {
  /** Resolves once the full scan that is under way when it is asked has settled (`VaultIndexer.whenIdle`). */
  whenIdle?: () => Promise<void>;
  /** How long a queue entry that was refused waits, after that scan, for its second attempt. */
  retryDelayMs?: number;
  /** Told that an entry could not be queued at either attempt (no path). */
  onDropped?: () => void;
}

/**
 * Queues what a pass announced. `stillDue` is asked before each attempt: an
 * entry may be seconds old by the time it gets there — it stood behind one
 * that waited, or waited itself. The promise it hands back settles when the
 * entry is queued or given up, and never rejects; nobody has to wait for it.
 */
export type Announce = (queue: () => Promise<unknown>, stillDue?: () => Promise<boolean>) => Promise<void>;

/**
 * What a pass sets off and nobody waits for: an upload or a remote deletion
 * to queue. For a file another program changed or removed, the index's word
 * is the only way the change reaches the sync, and it is said once — when a
 * pass notices. So an entry that is refused (another transaction is open) is
 * not let go at that: it waits for a full scan under way and a moment more,
 * and is tried once again. What fails then is counted, not dropped without a
 * word.
 *
 * The entries have a row of their own, so that nothing announced later
 * overtakes one that waits — and they take a turn in the shared row only for
 * each attempt, not across the wait: the door, and with it every save that
 * tells the index, must not stand behind an entry that waits for a scan.
 */
export function createAnnouncer(turns: IndexTurns, options: AnnouncerOptions = {}): Announce {
  const retryDelayMs = options.retryDelayMs ?? 400;
  let row: Promise<void> = Promise.resolve();
  return (queue, stillDue) => {
    // Unknown counts as due: what cannot be asked is still said.
    const due = async () => !stillDue || (await stillDue().catch(() => true));
    row = row
      .then(async () => {
        if (!(await due())) return;
        try {
          await turns.take(queue);
        } catch {
          await options.whenIdle?.();
          await wait(retryDelayMs);
          if (!(await due())) return;
          await turns.take(queue);
        }
      })
      .catch(() => {
        try {
          options.onDropped?.();
        } catch {
          // A line in the diagnostics is not worth the row.
        }
      });
    return row;
  };
}

export type PathReindexer = (paths: readonly string[]) => Promise<void>;

export interface PathReindexOptions {
  /** Shared with everything else that writes because of an index pass; its own when absent. */
  turns?: IndexTurns;
  /** Told how many paths of one call were left to the next full scan (a count, never a path). */
  onLeftBehind?: (count: number) => void;
  /**
   * Told that the second attempt changed the index — after whoever handed
   * the paths over has told the screens. A removal that waited for a scan
   * takes its file out of the lists only when they are drawn again. Not told
   * for a path whose second look found nothing to do.
   */
  onFollowedLate?: () => void;
  /** How long a path that failed waits for its second attempt. */
  retryDelayMs?: number;
}

type PathIndexer = Pick<VaultIndexer, "indexFile" | "indexPath"> & Partial<Pick<VaultIndexer, "whenIdle">>;

export function createPathReindexer(
  indexer: PathIndexer | null,
  adapter: Pick<IVaultAdapter, "getFileInfo">,
  options: PathReindexOptions = {},
): PathReindexer {
  const turns = options.turns ?? createIndexTurns();
  const retryDelayMs = options.retryDelayMs ?? 400;

  const look = async (path: string): Promise<VaultFileInfo | null> => {
    try {
      return await adapter.getFileInfo(path);
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "FILE_NOT_FOUND") throw error;
      return null;
    }
  };

  /** One pass over `paths`: the ones that could not be followed, whether a removal is among them, and how many changed the index. */
  const pass = async (index: PathIndexer, paths: readonly string[]): Promise<{ failed: string[]; removalWaits: boolean; followed: number }> => {
    const failed: string[] = [];
    let removalWaits = false;
    let followed = 0;
    for (const path of paths) {
      try {
        const outcome = await turns.take(async (): Promise<"followed" | "nothing to do" | "removal refused"> => {
          const info = await look(path);
          if (info) {
            await index.indexFile(info);
            return "followed";
          }
          try {
            const answer = await index.indexPath(path);
            return answer === "removed" || answer === "indexed" ? "followed" : "nothing to do";
          } catch {
            return "removal refused";
          }
        });
        if (outcome === "removal refused") {
          failed.push(path);
          removalWaits = true;
        } else if (outcome === "followed") {
          followed += 1;
        }
      } catch {
        failed.push(path);
      }
    }
    return { failed, removalWaits, followed };
  };

  return async (paths) => {
    if (!indexer) return;
    const first = await pass(indexer, paths);
    if (first.failed.length === 0) return;
    // A removal that was refused met an open transaction, most likely a full
    // scan's — and that one holds its transaction until it is through. (Or
    // the index could not look at the path itself; the second pass asks again.)
    if (first.removalWaits) await indexer.whenIdle?.();
    await wait(retryDelayMs);
    const second = await pass(indexer, first.failed);
    if (second.followed > 0) options.onFollowedLate?.();
    if (second.failed.length > 0) options.onLeftBehind?.(second.failed.length);
  };
}
