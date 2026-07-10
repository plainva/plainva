import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Viewport-clamped popover placement (plan Designsprache P12). The old
 * `.pv-popover` sat position:absolute inside its row — at the window edge
 * (right sidebar!) it overflowed and was clipped. This hook positions the
 * panel FIXED below/above the anchor, clamped to the viewport. Positioning is
 * written imperatively in a layout effect (no state round-trip, and the
 * react-hooks compiler rules forbid reading a ref-carrying hook result during
 * render); the panel starts hidden off-screen via `.pv-popover--fixed`.
 *
 * Usage: const popRef = useFixedPopover(open, anchorRef);
 *        {open && <div ref={popRef} className="pv-popover pv-popover--fixed">…</div>}
 *
 * Pass `undefined` as anchorRef to disable (legacy absolutely-positioned
 * call sites keep their own skin and skip the `--fixed` class).
 */
export function useFixedPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  opts: { minWidth?: number; margin?: number } = {}
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const { minWidth = 0, margin = 8 } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !anchorRef || !el) return;
    const measure = () => {
      const panel = ref.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;
      const a = anchor.getBoundingClientRect();
      panel.style.minWidth = `${Math.max(minWidth, a.width)}px`;
      const w = Math.max(panel.offsetWidth, minWidth, a.width);
      const h = panel.offsetHeight;
      const left = Math.min(Math.max(margin, a.left), Math.max(margin, window.innerWidth - w - margin));
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 4);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      // Back to the hidden off-screen base state so a re-open re-measures.
      el.style.left = "";
      el.style.top = "";
      el.style.minWidth = "";
      el.style.visibility = "";
    };
  }, [open, anchorRef, minWidth, margin]);

  return ref;
}
