import { getWindowBus } from "./windowBus";

/**
 * The owner's half of "a window that goes takes no typing with it" (A7).
 *
 * An editor's save waits a second after the last keystroke; until then what
 * was typed lives in the editor and in the draft journal's buffer, which
 * writes at most every 400 ms (longer for a large note). A window that is
 * destroyed in between — its close button, the app quitting — loses that
 * buffer: the page's own last word (`pagehide`) is not waited for, and the
 * webview can be gone before the write it starts reaches the disk.
 *
 * An auxiliary window does not write its snapshots itself: each one comes to
 * the owner as `draft-record`. So the owner knows which windows have ever
 * buffered a draft, and before one of them goes — or before the app goes —
 * it asks exactly those to write what they still hold (`drafts-flush`) and
 * waits for their answer (`drafts-flushed`). Never for long: a window that
 * hung, or never answers, must not keep anyone from closing it.
 */

/** How long the owner waits for windows to write what they buffered: a little past their own bound (`MOVE_WAIT_MS`). */
export const WINDOW_FLUSH_WAIT_MS = 2_500;

/** Windows that said they listen (`leave-listening`), or handed the owner a draft snapshot. */
const writers = new Set<string>();
/** Flushes waiting for answers, by id: the windows that still owe one. */
const waiting = new Map<string, { owed: Set<string>; done: () => void; cut: boolean }>();
let counter = 0;

/** This window listens: it said so, or it sent a snapshot (the owner's `leave-listening` and `draft-record` handlers). */
export function noteDraftWindow(label: string): void {
  writers.add(label);
}

/** This window is gone: nothing to ask it any more, and nothing to wait for. */
export function forgetDraftWindow(label: string): void {
  writers.delete(label);
  for (const [id, flush] of waiting) {
    if (flush.owed.delete(label) && flush.owed.size === 0) {
      waiting.delete(id);
      flush.done();
    }
  }
}

/** A window answered `drafts-flush`: what it had buffered has reached the owner — all of it, unless `cut`. */
export function noteDraftsFlushed(id: string, label: string, cut = false): void {
  const flush = waiting.get(id);
  if (!flush || !flush.owed.has(label)) return;
  if (cut) flush.cut = true;
  flush.owed.delete(label);
  if (flush.owed.size > 0) return;
  waiting.delete(id);
  flush.done();
}

/**
 * Asks these windows (`null`: every one) to do what they do before going —
 * leave their field, save, write their journal (`beforeLeaving.ts`) — and
 * resolves once they did, or after `WINDOW_FLUSH_WAIT_MS`. A window that never
 * said it listens is not asked, so closing it waits for nothing. True when
 * every window asked was done in time; false when one did not answer, or
 * answered that its own wait ran out.
 */
export async function flushWindowDrafts(labels: readonly string[] | null, waitMs = WINDOW_FLUSH_WAIT_MS): Promise<boolean> {
  const owed = new Set((labels ?? [...writers]).filter((label) => writers.has(label)));
  if (owed.size === 0) return true;
  counter += 1;
  const id = `drafts-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const entry = { owed, done: () => {}, cut: false };
  const answered = new Promise<boolean>((resolve) => {
    entry.done = () => resolve(!entry.cut);
    waiting.set(id, entry);
    timer = setTimeout(() => resolve(false), waitMs);
  });
  try {
    const bus = await getWindowBus();
    await bus.broadcast("drafts-flush", { id, labels: [...owed] }, null);
    return await answered;
  } catch {
    // No bus: nobody to ask.
    return true;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    waiting.delete(id);
  }
}

/** Test seam — the app never resets this. */
export function resetWindowDraftFlushForTest(): void {
  writers.clear();
  waiting.clear();
}
