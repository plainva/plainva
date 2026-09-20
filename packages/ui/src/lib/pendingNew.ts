import type { NewItemId } from "./newCatalog";

/**
 * A "New …" request that has to travel to a surface first (Design-Runde E4).
 *
 * A new term needs the calendar, a new task the task list: the shell opens the
 * view and asks it to start one. The view may be mounting at that moment, so
 * the request is parked here and consumed when the view is ready — a window
 * event alone would fire before the listener exists. Both shells use the same
 * store; the palette, the sidebar menu and the phone's FAB all go through it.
 *
 * A request may carry TEXT (plan Journal, J4): the capture sheet has two kinds,
 * task and journal, and switching the kind after typing must not cost the
 * sentence. The surface that takes the request gets what was typed so far.
 */
export const NEW_REQUEST_EVENT = "plainva-new-request";

const pending = new Map<NewItemId, string>();

/** Parks the request and tells any mounted surface at once. */
export function requestNew(id: NewItemId, text = ""): void {
  pending.set(id, text);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NEW_REQUEST_EVENT, { detail: { id } }));
}

/** The parked text once (`""` when the request carried none), `null` when nothing waits. */
export function takePendingNewText(id: NewItemId): string | null {
  const text = pending.get(id);
  if (text === undefined) return null;
  pending.delete(id);
  return text;
}

/** True once — the surface that takes it owes the user the thing. */
export function takePendingNew(id: NewItemId): boolean {
  return takePendingNewText(id) !== null;
}

/**
 * Subscribes a mounted surface: runs `handle` now if a request waits, and
 * again whenever a new one arrives. Returns the unsubscribe for the effect.
 */
export function consumePendingNew(id: NewItemId, handle: (text: string) => void): () => void {
  const run = () => {
    const text = takePendingNewText(id);
    if (text !== null) handle(text);
  };
  run();
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NEW_REQUEST_EVENT, run);
  return () => window.removeEventListener(NEW_REQUEST_EVENT, run);
}
