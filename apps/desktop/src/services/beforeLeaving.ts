import { personWritesInFlight, settleInflightWrites } from "./inflightWrites";
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

/**
 * The longest a window waits for its writes when nobody gave a limit: below
 * the central window's wait for the others (`windowDraftFlush.ts`), so a window
 * answers before it is given up on.
 */
export const SETTLE_LIMIT_MS = 1_500;

// What the shared surfaces hold back for a moment (the phone writes the same
// when it goes to the background, `apps/mobile/src/services/appLifecycle.ts`):
// graph pins (800 ms) and the task view's filters (250 ms).
if (typeof window !== "undefined") {
  onBeforeLeaving(() => flushGraphStates());
  onBeforeLeaving(async () => flushTaskViewStates());
}

/**
 * Leaves the field in progress, has every surface write now, and waits for
 * this window's writes — at most `limitMs`. "cut" when something of the
 * person's was still going at the limit: a surface's work (a draft, a note's
 * save) or one of their writes that hangs. Writes that keep coming from a sync
 * pull are waited for up to the limit too, but are no cut: the next start pulls
 * again (review 2026-11-17).
 */
export async function settleBeforeLeaving(limitMs: number = SETTLE_LIMIT_MS, onOwed?: () => Promise<unknown>): Promise<"settled" | "cut"> {
  if (typeof document === "undefined" || typeof window === "undefined") return "settled";
  const until = Date.now() + limitMs;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
  // The field's own handler runs on the blur; its write starts from there.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const works: Promise<unknown>[] = [];
  const request: BeforeLeavingRequest = { waitUntil: (work) => void works.push(work) };
  window.dispatchEvent(new CustomEvent(BEFORE_LEAVING_EVENT, { detail: request }));
  // Something of the person's to do, read off this very list (review
  // 2026-11-18): a surface's part that does not end at once — a draft, a
  // note's save, the mail queue in its undo window — or a write of theirs on
  // its way, a field left by the blur above included. Then `onOwed` puts the
  // mark down before the wait, so an end harder than the deadline is said.
  const pending = await Promise.race([
    Promise.allSettled(works).then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 0)),
  ]);
  if ((pending || personWritesInFlight() > 0) && onOwed) {
    await onOwed().catch(() => {
      // silent: without the mark only an end harder than the deadline goes unsaid.
    });
  }
  let cut = false;
  await Promise.race([
    Promise.allSettled(works),
    new Promise<void>((resolve) => setTimeout(() => {
      cut = true;
      resolve();
    }, Math.max(0, until - Date.now()))),
  ]);
  if (cut) return "cut";
  const quiet = await settleInflightWrites(QUIET_MS, Math.max(0, until - Date.now()));
  return quiet || personWritesInFlight() === 0 ? "settled" : "cut";
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
        return "settled" as const;
      })
      .then((settled) => bus.request("drafts-flushed", { id, cut: settled === "cut" }))
      .catch(() => {
        // silent: without the answer the central window goes on after its deadline (`windowDraftFlush.ts`).
      });
  });
  await bus.request("leave-listening", {}).catch(() => {
    // silent: not announced, this window is not waited for; its journal's own writes still go out.
  });
  return off;
}
