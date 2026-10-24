import { useCallback, useLayoutEffect, useState } from "react";

/** At this width of a database's head, and below it, its buttons drop their labels. */
export const BASE_HEAD_NARROW = 600;

/**
 * Whether a database's head is narrow — measured on the head itself and handed
 * to the stylesheet as `data-narrow`.
 *
 * This used to be a container query on the head. But the head is where a
 * database's menus and popovers open, and all of them are placed by the WINDOW
 * (`position: fixed`). A size container is not a neutral thing for those: in
 * the first form of the specification `container-type` brought layout
 * containment with it, and an engine that still follows that form — WebKit
 * did for longest, and the app's floor reaches back to such versions — makes
 * the container the box a fixed descendant is placed in. The surfaces would
 * land displaced by the head's own offset, and under the floating windows.
 * The sidebars measure for the same reason (lib/sidebarStep.ts).
 *
 * A CALLBACK ref, and the first measurement is taken in it: the update lands in
 * the commit that attaches the head, so the first frame is already right.
 */
export function useNarrowHead(): { narrow: boolean; ref: (el: HTMLElement | null) => void } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setNarrow(isNarrowHead(node)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const ref = useCallback((el: HTMLElement | null) => {
    setNode(el);
    if (el) setNarrow(isNarrowHead(el));
  }, []);
  return { narrow, ref };
}

/**
 * The room the head has for its content: its box without padding and border —
 * the width the container query asked for, so the labels go where they went.
 */
export function headContentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const edges = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, px) => sum + (parseFloat(px) || 0), 0);
  return el.getBoundingClientRect().width - edges;
}

/** Nothing to say before the head has a width. */
export function isNarrowHead(el: HTMLElement): boolean {
  const width = headContentWidth(el);
  return width > 0 && width <= BASE_HEAD_NARROW;
}
