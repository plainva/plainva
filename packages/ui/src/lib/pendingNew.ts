import type { NewItemId } from "./newCatalog";

/**
 * A "New …" request that has to travel to a surface first (Design-Runde E4).
 *
 * A new term needs the calendar, a new task the task list: the shell opens the
 * view and asks it to start one. The view may be mounting at that moment, so
 * the request is parked here and consumed when the view is ready — a window
 * event alone would fire before the listener exists. Both shells use the same
 * store; the palette, the sidebar menu and the phone's FAB all go through it.
 */
export const NEW_REQUEST_EVENT = "plainva-new-request";

const pending = new Set<NewItemId>();

/** Parks the request and tells any mounted surface at once. */
export function requestNew(id: NewItemId): void {
  pending.add(id);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NEW_REQUEST_EVENT, { detail: { id } }));
}

/** True once — the surface that takes it owes the user the thing. */
export function takePendingNew(id: NewItemId): boolean {
  return pending.delete(id);
}

/**
 * Subscribes a mounted surface: runs `handle` now if a request waits, and
 * again whenever a new one arrives. Returns the unsubscribe for the effect.
 */
export function consumePendingNew(id: NewItemId, handle: () => void): () => void {
  const run = () => {
    if (takePendingNew(id)) handle();
  };
  run();
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NEW_REQUEST_EVENT, run);
  return () => window.removeEventListener(NEW_REQUEST_EVENT, run);
}
