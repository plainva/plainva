import { UndoSendQueue, secondsLeft, UNDO_SEND_MS } from "../mail/undoSend";
import { toast } from "../services/toastStore";
import { readProviderTaskAnchor, type ProviderTaskAnchor } from "./providerTask";
import i18n from "../i18n";

/**
 * Deleting a task in Plainva also deletes it at the provider (E4b), after a
 * window in which it can still be taken back (E4c).
 *
 * The rule until now was one-directional on purpose: a note that had vanished
 * NEVER deleted the remote task, because "the file is gone" has too many
 * innocent causes — a half-finished sync, a rebuilt index, a folder that has
 * not arrived yet. That reasoning still holds, and this does not weaken it.
 *
 * What changes is that a CONFIRMED deletion is a different fact from a missing
 * file. The user stood in front of the cascade dialog and said delete; treating
 * that as "local only" left the task alive at the provider and the next sync
 * imported it right back. Which is the same duplicate, arriving by a second
 * road.
 *
 * Three decisions worth keeping:
 *
 * 1. **The window is a delay, not an undo.** Nothing is sent to the provider
 *    while it runs — exactly the mail pattern, and the wording says so.
 *
 * 2. **The end of a session cancels, it does not flush.** Mail flushes on
 *    `beforeunload` because a message the writer asked to send must not vanish.
 *    Here the opposite is true: the safe end of an interrupted deletion is that
 *    the task still exists. A wrongly kept task is a nuisance; a wrongly
 *    deleted one is gone at the provider too.
 *
 * 3. **The provider call belongs to the reconciler, not to this module.** It
 *    owns the target, the etag and the CalDAV href, and it retries next cycle.
 *    This module records the intent — the same shape as
 *    `noteUserInitiatedDeletion` on the file sync.
 */

/** One task whose note was deleted and whose provider copy should follow. */
export interface TaskDeletionOrder {
  notePath: string;
  uid: string;
  list: string;
  /** From the anchor; used to pick the account among several. */
  provider?: string;
  identity?: string;
  account?: string;
}

/** The note as it was, so "undo" gives back the work and not just the file. */
interface PendingDeletion {
  order: TaskDeletionOrder;
  content: string;
}

export interface TaskDeletionDeps {
  /** Restores a note on undo. Injected so this module stays free of the vault. */
  writeTextFile(path: string, content: string): Promise<void>;
  /** Pokes the reconciler once the window has closed. */
  runTaskSync?(): void;
  /** Re-index the restored notes so the tree and the databases see them again. */
  onRestored?(paths: string[]): void;
}

/** Identity of an order. JSON rather than a joined string: a CalDAV list id is
 *  an href and a uid travels through exports, so no single separator is safe —
 *  and a NUL byte, the usual trick, makes the source file count as binary. */
function orderKey(o: TaskDeletionOrder): string {
  return JSON.stringify([o.list, o.uid]);
}

/**
 * Orders whose window has closed and that the reconciler has not carried out
 * yet. Session-scoped like the file sync's confirmed-deletion memo: if the app
 * closes between the window and the next cycle, the task stays at the provider.
 * That is the harmless direction, and persisting it would mean a schema change
 * for a gap measured in seconds.
 */
const armed = new Map<string, TaskDeletionOrder>();

let deps: TaskDeletionDeps | null = null;
let toastId: number | null = null;

const queue = new UndoSendQueue<PendingDeletion[]>(async (batch) => {
  for (const p of batch) armed.set(orderKey(p.order), p.order);
  if (toastId !== null) {
    // The toast dies WITH the window: a visible "undo" that no longer works is
    // worse than no button at all.
    toast.dismiss(toastId);
    toastId = null;
  }
  deps?.runTaskSync?.();
});

/**
 * Ends a running window WITHOUT carrying the deletion out — decision 2 above,
 * and the one call each shell has to wire to its own "we are going away" event.
 *
 * It is deliberately NOT hooked up here. This module used to attach a
 * module-level `beforeunload` listener, which is right on the desktop and
 * silently wrong on the phone: a Capacitor WebView does not fire
 * `beforeunload` when the app is backgrounded, so the window would simply
 * keep running and a deletion the user walked away from would be carried out.
 *
 * The two shells therefore call this from opposite-looking places for the same
 * reason:
 *   - desktop: `beforeunload`
 *   - mobile:  `appStateChange` (isActive === false)
 *
 * Mail does the OPPOSITE on the phone and flushes on the same event, because
 * there the safe outcome is reversed: a message the writer asked to send must
 * not vanish, while an interrupted deletion is safest when the task survives.
 * Both follow from one question — "what is the safe outcome?" — so do not
 * unify them.
 */
export function cancelInFlightTaskDeletion(): void {
  const entry = queue.current();
  if (entry) queue.cancel(entry.id);
}

export function initTaskDeletion(d: TaskDeletionDeps): void {
  deps = d;
}

/** Reads the anchors of notes about to be deleted. Must run BEFORE the files
 *  are gone — that is the only moment their anchor is still readable. */
export function collectTaskAnchors(
  notes: ReadonlyArray<{ path: string; content: string }>
): Array<{ path: string; content: string; anchor: ProviderTaskAnchor }> {
  const out: Array<{ path: string; content: string; anchor: ProviderTaskAnchor }> = [];
  for (const n of notes) {
    const anchor = readProviderTaskAnchor(n.content);
    if (anchor) out.push({ path: n.path, content: n.content, anchor });
  }
  return out;
}

/**
 * Starts the window for a confirmed deletion.
 *
 * A second deletion while one is waiting flushes the first immediately (the
 * queue's own rule): the earlier one is clearly no longer what is being
 * reconsidered, and two countdowns would leave the reader guessing which
 * "undo" belongs to which.
 */
export function requestTaskDeletion(
  anchored: ReadonlyArray<{ path: string; content: string; anchor: ProviderTaskAnchor }>
): void {
  if (anchored.length === 0) return;
  const batch: PendingDeletion[] = anchored.map((a) => ({
    content: a.content,
    order: {
      notePath: a.path,
      uid: a.anchor.uid,
      list: a.anchor.list,
      ...(a.anchor.provider ? { provider: a.anchor.provider } : {}),
      ...(a.anchor.identity ? { identity: a.anchor.identity } : {}),
      ...(a.anchor.account ? { account: a.anchor.account } : {}),
    },
  }));
  const entry = queue.enqueue(batch);
  const t = i18n.t.bind(i18n);
  toastId = toast.progress(
    t("tasks.deletingWithUndo", { count: batch.length, seconds: secondsLeft(entry) }),
    {
      label: t("common.undo"),
      run: () => {
        if (!queue.cancel(entry.id)) return;
        void restore(batch);
      },
    }
  );
}

async function restore(batch: PendingDeletion[]): Promise<void> {
  if (toastId !== null) {
    toast.dismiss(toastId);
    toastId = null;
  }
  const restored: string[] = [];
  for (const p of batch) {
    try {
      await deps?.writeTextFile(p.order.notePath, p.content);
      restored.push(p.order.notePath);
    } catch (e) {
      console.error("[taskDeletion] restoring the note failed", p.order.notePath, e);
    }
  }
  if (restored.length > 0) deps?.onRestored?.(restored);
  const t = i18n.t.bind(i18n);
  toast.info(t("tasks.deleteCancelled", { count: batch.length }));
}

/**
 * Orders whose window is still RUNNING — nothing to carry out yet, but the
 * reconciler must not tombstone them either.
 *
 * Without this a cycle inside the window would see a state row whose note is
 * gone and write "never import this again". Undo would then hand the note back
 * as an orphan: present in the vault, ignored by every later cycle.
 */
export function taskDeletionsInFlight(): TaskDeletionOrder[] {
  return (queue.current()?.payload ?? []).map((p) => p.order);
}

/** The orders the reconciler should carry out this cycle. */
export function pendingTaskDeletions(): TaskDeletionOrder[] {
  return [...armed.values()];
}

/**
 * Reports what happened to one order.
 *
 * `retry` keeps it: a network failure is worth another cycle. Everything else
 * drops it — a task that is gone is done, and a conflict must not turn into an
 * endless loop against a note the user has already removed.
 */
export function resolveTaskDeletion(order: TaskDeletionOrder, outcome: "done" | "conflict" | "retry"): void {
  if (outcome === "retry") return;
  armed.delete(orderKey(order));
}

/** Test seam: drops everything waiting. */
export function __resetTaskDeletionsForTest(): void {
  armed.clear();
  const entry = queue.current();
  if (entry) queue.cancel(entry.id);
  toastId = null;
}

export { UNDO_SEND_MS };
