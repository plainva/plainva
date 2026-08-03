/**
 * How far the surface below the chrome has scrolled, and in which direction
 * (S11). Two pieces of chrome react to it and they sit in different subtrees:
 * the app bar raises itself, the navigation bar draws itself in.
 *
 * The app bar is the one that finds the scrolling element (it is inside it), so
 * it publishes here and the bar subscribes. One listener, two readers — better
 * than a second listener that would have to guess the same element.
 */

export interface ChromeScroll {
  /** Content has moved under the chrome — the bar raises itself. */
  scrolled: boolean;
  /** Reading downwards: the navigation bar retreats until the user comes back. */
  away: boolean;
}

let state: ChromeScroll = { scrolled: false, away: false };
const listeners = new Set<() => void>();

export function getChromeScroll(): ChromeScroll {
  return state;
}

export function subscribeChromeScroll(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setChromeScroll(next: ChromeScroll): void {
  if (next.scrolled === state.scrolled && next.away === state.away) return;
  state = next;
  for (const fn of listeners) fn();
}

/** A new surface starts at the top — otherwise it inherits the last one's state. */
export function resetChromeScroll(): void {
  setChromeScroll({ scrolled: false, away: false });
}
