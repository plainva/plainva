/**
 * The element that actually scrolls `el`'s content: `el` itself if its content
 * overflows it, otherwise the nearest ancestor whose content does. Null when
 * nothing scrolls (yet) - a caller then measures against the viewport.
 *
 * "Has `overflow: auto`" is not the same as "scrolls". The phone's pinboard is
 * a `.m-page` inside the database's `.m-page`: both say `overflow-y: auto`,
 * but only the outer one has a height to overflow - the inner one is simply as
 * tall as its cards. Code that took the inner element for the scroller watched
 * a box nothing is ever outside of: every card of a 150-card board counted as
 * "on screen", the scroll position was saved from an element whose
 * `scrollTop` is always 0, and the edge scrolling of a drag moved nothing
 * (TestFlight 2026-10-04).
 */
export function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}
