/**
 * Auto-scroll while dragging a row (plan § 9.3).
 *
 * Both arranging surfaces outgrew one screen: the mobile navigation-bar screen
 * carries eight entries plus a stepper and a preview, and the desktop action
 * rail is up to ten. Without this, moving a row from the bottom of the list to
 * the top is not one gesture — pointer capture means the surface under the
 * finger never scrolls on its own, so the drag simply stops at the edge.
 *
 * Framework-free on purpose: the two call sites use different drag mechanics
 * (a hold gesture here, a grip handle there) and only share the need to keep
 * scrolling while the pointer sits near an edge.
 */

/** How close to an edge the pointer has to get before scrolling starts. */
const EDGE_PX = 56;
/** Pixels per animation frame at the very edge; it eases in over the zone. */
const MAX_STEP = 14;

export interface DragAutoScroll {
  /** Feed every pointer move; scrolling starts and stops on its own. */
  update(clientY: number): void;
  /** Drag over (or cancelled) — always call this, it stops the loop. */
  stop(): void;
}

/** Nearest ancestor that can actually scroll vertically (window as fallback). */
function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n; n = n.parentElement) {
    const style = getComputedStyle(n);
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrollable && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

/**
 * @param getRoot the dragged list's element; its scrolling ancestor is the one
 *        that moves. Resolved lazily so it works with a ref that fills in late.
 */
export function createDragAutoScroll(getRoot: () => Element | null): DragAutoScroll {
  let raf: number | null = null;
  let step = 0;

  const tick = () => {
    raf = null;
    if (step === 0) return;
    const box = scrollParent(getRoot());
    if (box) box.scrollTop += step;
    else window.scrollBy(0, step);
    raf = requestAnimationFrame(tick);
  };

  return {
    update(clientY: number) {
      const box = scrollParent(getRoot());
      const rect = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const overTop = rect.top + EDGE_PX - clientY;
      const overBottom = clientY - (rect.bottom - EDGE_PX);

      // Ease in across the zone instead of jumping to full speed at its edge:
      // a constant step makes precise drops near the boundary impossible.
      if (overTop > 0) step = -Math.ceil((Math.min(overTop, EDGE_PX) / EDGE_PX) * MAX_STEP);
      else if (overBottom > 0) step = Math.ceil((Math.min(overBottom, EDGE_PX) / EDGE_PX) * MAX_STEP);
      else step = 0;

      if (step !== 0 && raf === null) raf = requestAnimationFrame(tick);
      if (step === 0 && raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
    stop() {
      step = 0;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
  };
}
