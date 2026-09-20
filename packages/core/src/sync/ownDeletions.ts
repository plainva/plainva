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
 * deletion again. The expiry only keeps an unanswered mark from living forever.
 */
import { normalizeJournalPath } from "./deletionJournal.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class OwnDeletionRegister {
  private readonly marks = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Called by the worker right before it removes `path` locally. */
  mark(path: string): void {
    const key = normalizeJournalPath(path);
    if (!key) return;
    this.sweep();
    this.marks.set(key, this.now() + this.ttlMs);
  }

  /** The file is still there after all (the delete failed): forget the mark. */
  unmark(path: string): void {
    this.marks.delete(normalizeJournalPath(path));
  }

  /**
   * True exactly once for a marked path — or for a path below a marked FOLDER,
   * which stays marked until it expires because a folder vanishing reports one
   * event per file inside it.
   */
  consume(path: string): boolean {
    const key = normalizeJournalPath(path);
    if (!key) return false;
    const at = this.now();
    const own = this.marks.get(key);
    if (own !== undefined) {
      this.marks.delete(key);
      if (own >= at) return true;
    }
    let idx = key.lastIndexOf("/");
    while (idx > 0) {
      const expiry = this.marks.get(key.substring(0, idx));
      if (expiry !== undefined && expiry >= at) return true;
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
    for (const [key, expiry] of this.marks) if (expiry < at) this.marks.delete(key);
  }
}
