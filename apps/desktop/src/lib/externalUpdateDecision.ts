/**
 * Pure decision for the editor's reaction to an on-disk change while the buffer
 * is DIRTY (unsaved edits). Extracted so the matrix is unit-testable:
 *
 * - "realign":  disk already equals the draft (e.g. echo of our own push) —
 *               clear the dirty flag, nothing to reload.
 * - "own-echo": disk equals the last text WE persisted — the watcher echo of our
 *               own save (or a stale-hash false positive from the sync race)
 *               arriving while the user kept typing. Keep the draft; no conflict.
 * - "preserve-conflict": a genuinely different version reached the disk — save
 *               the draft as a .CONFLICT sibling and adopt the disk version (3e).
 */
export type DirtyExternalUpdateAction = "realign" | "own-echo" | "preserve-conflict";

export function decideDirtyExternalUpdate(opts: {
  /** Current file content on disk (LF-normalized). */
  disk: string;
  /** Current editor buffer (the unsaved draft). */
  draft: string;
  /** Text of the editor's last successful own write for this file, or null. */
  lastPersisted: string | null;
}): DirtyExternalUpdateAction {
  if (opts.disk === opts.draft) return "realign";
  if (opts.lastPersisted !== null && opts.disk === opts.lastPersisted) return "own-echo";
  return "preserve-conflict";
}
