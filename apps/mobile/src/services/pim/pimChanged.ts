/**
 * `m-pim-changed`: the phone's one signal that what the calendar screens show
 * may have changed - a sync wrote to the cache, or a write on its way began,
 * settled or was refused (issue 119). The screens that show appointments
 * ("Today", a database's calendar backdrop) reload on it, as the desktop's do
 * on the overlay. A light module of its own, so that both halves can be
 * tested without a screen.
 */
export const PIM_CHANGED = "m-pim-changed";

/** Calls `listener` on every change; returns the way to stop. */
export function onPimChanged(target: EventTarget, listener: () => void): () => void {
  const handler = () => listener();
  target.addEventListener(PIM_CHANGED, handler);
  return () => target.removeEventListener(PIM_CHANGED, handler);
}

/** Every change of `store` (the writes on their way) is announced as a change. */
export function announceStoreChanges(store: { subscribe(listener: () => void): () => void }, target: EventTarget): () => void {
  return store.subscribe(() => target.dispatchEvent(new CustomEvent(PIM_CHANGED)));
}
