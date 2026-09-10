/**
 * "Open this note, then go to that anchor" (issue #92, P5) — the park
 * pattern the sidebar calendar uses for its day (`calendarNav.ts`): the
 * editor that will show the note may not be mounted yet when the link is
 * clicked, so the anchor is parked under the path AND announced as an event.
 * A mounted editor of that path reacts to the event; a freshly mounting one
 * consumes the park once its document is in. Both shells share it.
 */
export const ANCHOR_JUMP_EVENT = "plainva-goto-anchor";

const pending = new Map<string, string>();

export function requestAnchorJump(path: string, anchor: string): void {
  pending.set(path, anchor);
  window.dispatchEvent(new CustomEvent(ANCHOR_JUMP_EVENT, { detail: { path, anchor } }));
}

/** The parked anchor for `path`, taken off the park. */
export function consumePendingAnchorJump(path: string): string | null {
  const a = pending.get(path) ?? null;
  pending.delete(path);
  return a;
}
