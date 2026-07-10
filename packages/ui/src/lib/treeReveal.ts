/**
 * One-shot hand-off for "reveal in file tree": the editor's ⋮ menu fires while
 * the tree may be UNMOUNTED (tags/bookmarks tab active) or hidden (sidebar
 * collapsed). App un-collapses/switches on the event; the tree consumes the
 * parked path when it (re)mounts. Mirrors the searchJump park-store pattern
 * (the lazily mounted editor had the same listener-not-yet-there problem).
 */
let pendingReveal: string | null = null;

export function parkTreeReveal(path: string): void {
  pendingReveal = path;
}

/** Returns the parked path once and clears it (null when nothing is parked). */
export function consumePendingTreeReveal(): string | null {
  const p = pendingReveal;
  pendingReveal = null;
  return p;
}
