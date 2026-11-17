import { settleInflightWrites } from "./inflightWrites";
import { flushGraphStates, flushTaskViewStates } from "@plainva/ui";
import { getWindowBus } from "./windowBus";

/**
 * What a window does before it goes, or before the app goes (A7, A3, O3).
 *
 * Typing that is not on disk yet lives in four places: a field in progress (a
 * table cell, a property, a card being renamed), which takes its value when it
 * is left; an editor's save, a second after the last keystroke; the parked
 * copy of the suggestion mode, half a second after the last change; and the
 * draft journal's buffer. Until 2026-11-16 none of them was waited for when a
 * window or the app went.
 *
 * So, in this order: the field in progress is left, as if the person had
 * clicked elsewhere — it takes its value its usual way, and one that drops
 * what it holds on leaving drops it here too. Then every surface with a write
 * still to come does it now (`BEFORE_LEAVING_EVENT`: the editor, the parked
 * copy, the draft journal), and the window waits for its writes on their way
 * (`inflightWrites.ts`). Bounded by whoever asks: the native side's deadline
 * for the central window, the central window's for another one.
 */

/** Dispatched on `window`; a surface with a write still to come joins with `waitUntil`. */
export const BEFORE_LEAVING_EVENT = "plainva-before-leaving";

export interface BeforeLeavingRequest {
  waitUntil(work: Promise<unknown>): void;
}

/** How long no write may start before the window counts as done. */
const QUIET_MS = 100;

// What the shared surfaces hold back for a moment (the phone writes the same
// when it goes to the background, `apps/mobile/src/services/appLifecycle.ts`):
// graph pins (800 ms) and the task view's filters (250 ms).
if (typeof window !== "undefined") {
  onBeforeLeaving(() => flushGraphStates());
  onBeforeLeaving(async () => flushTaskViewStates());
}

/** Leaves the field in progress, has every surface write now, and waits for this window's writes. */
export async function settleBeforeLeaving(): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
  // The field's own handler runs on the blur; its write starts from there.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const works: Promise<unknown>[] = [];
  const request: BeforeLeavingRequest = { waitUntil: (work) => void works.push(work) };
  window.dispatchEvent(new CustomEvent(BEFORE_LEAVING_EVENT, { detail: request }));
  await Promise.allSettled(works);
  await settleInflightWrites(QUIET_MS);
}

/** A surface's part: `work` runs when the window is about to go. Returns the way to take it out. */
export function onBeforeLeaving(work: () => Promise<unknown>): () => void {
  const listener = (event: Event) => (event as CustomEvent<BeforeLeavingRequest>).detail.waitUntil(Promise.resolve().then(work));
  window.addEventListener(BEFORE_LEAVING_EVENT, listener);
  return () => window.removeEventListener(BEFORE_LEAVING_EVENT, listener);
}

/**
 * Installed once in every other window: the central window asks before this
 * one, or the app, goes (`drafts-flush`), and goes on after the answer or a
 * moment. Said to the central window as soon as it listens, so a window that
 * does not — a start that failed, a page loading again — is not waited for.
 */
export async function installLeaveAnswer(): Promise<() => void> {
  const bus = await getWindowBus();
  const off = await bus.onBroadcast("drafts-flush", ({ id, labels }) => {
    if (labels !== null && !labels.includes(bus.label)) return;
    void settleBeforeLeaving()
      .catch(() => {
        // silent: the window is about to go; the answer below still lets the central one go on.
      })
      .then(() => bus.request("drafts-flushed", { id }))
      .catch(() => {
        // silent: without the answer the central window goes on after its deadline (`windowDraftFlush.ts`).
      });
  });
  await bus.request("leave-listening", {}).catch(() => {
    // silent: not announced, this window is not waited for; its journal's own writes still go out.
  });
  return off;
}
