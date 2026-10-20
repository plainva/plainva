/**
 * Deletions the sync worker carries out ITSELF are not the user's deletions
 * (finding 2026-09-20).
 *
 * The worker mirrors a remote deletion by removing the local file. The indexer
 * then notices a file vanished and tells the shell — and the shell, unable to
 * tell who removed it, queued a REMOTE delete for it. For a file that really is
 * gone remotely that echo is a no-op. On the day a Drive listing came back with
 * a fraction of the tree it was not: 898 wrongly removed local files went back
 * up as 898 remote deletions, and a second danger dialog asked to confirm them.
 *
 * Writes have had this distinction for a long time (`isOwnWrite`); this is the
 * same rule for deletions. The worker marks a path BEFORE it removes the file,
 * the shells' `onLocalFileDeleted` asks once and then queues nothing.
 *
 * One-shot on purpose: the mark answers the event it caused and nothing later.
 * A note the user recreates under the same name and then deletes is the user's
 * deletion again.
 *
 * And it answers for the FILE it was set for, not for the path (finding
 * 2026-10-12). The mark used to be a path and an hour. It was taken back by
 * the question it answered — and where nobody asked, it stood: the index held
 * no row for the file (one a pull wrote a moment before, any file while the
 * index is rebuilt), or the file was back before a pass had looked. A file
 * created under that name within the hour and deleted outside the app was
 * answered by the old mark: its deletion was never queued, and the file stayed
 * on the remote and on every other device. So the worker says which index rows
 * its removal can be reported for (`IndexedRowStamp`): the row the index holds
 * for the file when it asks, and the file's own time — what every row a pass
 * writes for exactly this file carries, also one written or read again after
 * the question (a scan that read the file before it went). The index says
 * which row it removed, and a mark answers for those rows only; a later file
 * of that name carries a time of its own. The expiry is what keeps a mark
 * nobody asks for from living forever, and nothing more.
 */
import { normalizeJournalPath } from "./deletionJournal.js";
import type { IndexedRowStamp } from "../vault/indexedRowStamp.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

interface Mark {
  expires: number;
  /** The read stamps a row of the removed file can carry; absent where the marker could not say. */
  rows?: number[];
}

export class OwnDeletionRegister {
  private readonly marks = new Map<string, Mark>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Called by the worker right before it removes `path` locally. `rows` are
   * the stamps an index row of that file can carry (see above); none at all
   * sets no mark. Without `rows` the mark answers for the path — for a whole
   * folder, and for a caller that cannot say.
   */
  mark(path: string, rows?: readonly IndexedRowStamp[]): void {
    const key = normalizeJournalPath(path);
    if (!key || (rows !== undefined && rows.length === 0)) return;
    this.sweep();
    this.marks.set(key, { expires: this.now() + this.ttlMs, ...(rows ? { rows: rows.map((r) => r.mtime) } : {}) });
  }

  /** The file is still there after all (the delete failed): forget the mark. */
  unmark(path: string): void {
    this.marks.delete(normalizeJournalPath(path));
  }

  /**
   * True exactly once for a marked path — or for a path below a marked FOLDER,
   * which stays marked until it expires because a folder vanishing reports one
   * event per file inside it.
   *
   * `row` is the index row whose removal is being reported. A mark set for
   * rows answers for those only: another one at the path is another file, and
   * the mark goes without answering — the file it was set for is gone, its
   * removal will not be reported any more.
   */
  consume(path: string, row?: IndexedRowStamp): boolean {
    const key = normalizeJournalPath(path);
    if (!key) return false;
    const at = this.now();
    const own = this.marks.get(key);
    if (own !== undefined) {
      this.marks.delete(key);
      if (own.expires >= at && (own.rows === undefined || (row !== undefined && own.rows.includes(row.mtime)))) return true;
    }
    let idx = key.lastIndexOf("/");
    while (idx > 0) {
      const mark = this.marks.get(key.substring(0, idx));
      if (mark !== undefined && mark.expires >= at) return true;
      idx = key.lastIndexOf("/", idx - 1);
    }
    return false;
  }

  /** How many marks are waiting — for tests and diagnostics. */
  get size(): number {
    this.sweep();
    return this.marks.size;
  }

  private sweep(): void {
    const at = this.now();
    for (const [key, mark] of this.marks) if (mark.expires < at) this.marks.delete(key);
  }
}
