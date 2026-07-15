import { useCallback, useRef, useSyncExternalStore } from "react";
import type React from "react";
import { noteDisplayName } from "@plainva/ui";

/**
 * Shared helpers for the two tab strips (the title-bar strip when unsplit and the
 * per-pane PaneTabStrip when split), kept in one place so their behaviour never
 * diverges.
 *
 * Drag is pointer-event based, NOT HTML5 drag-and-drop: Tauri's native drag-drop
 * handler (dragDropEnabled defaults to true) swallows HTML5 DnD, which is why the
 * card, column and sidebar reorders are already pointer-driven (see
 * useCardPointerDrag). Tabs now follow the same mechanic, so reordering within a
 * strip and moving between panes both work natively (#5). Drop hit-testing reads
 * the strips' `data-pv-*` attributes from the DOM at drag time (in handlers only),
 * so a drag started in one strip can target tabs in the other without any
 * render-time ref plumbing. The transient drop-indicator state is exposed via a
 * useSyncExternalStore store so both strips re-render on it.
 */

/** Tab label from a path: the file name without its `.md` / `.base` extension (plan D3).
 *  Virtual tabs (the vault map) carry the product name; the strips overlay the
 *  localized label where they have i18n access (plan Graph D1). */
export function tabLabel(path: string): string {
  if (path === "plainva://graph") return "Graph";
  if (path === "plainva://tasks") return "Tasks";
  return noteDisplayName(path) || "Untitled";
}

export interface TabDropTarget { paneIndex: number; tabIndex: number; side: "before" | "after"; }

const DRAG_THRESHOLD_PX = 5;

/** data-* attributes the strips set so hit-testing can find tabs/strips in the DOM. */
export const TAB_ATTR = "data-pv-tab";
export const PANE_ATTR = "data-pv-pane";
export const STRIP_ATTR = "data-pv-tabstrip";

// The one in-flight drag; touched only in event handlers, never read during render.
let activeDrag: { paneIndex: number; tabIndex: number; startX: number; startY: number; moved: boolean } | null = null;

// External store for the drop indicator / dragged tab, shared across strip
// instances (a drag in one strip must mark a target in the other).
interface DragSnapshot { over: TabDropTarget | null; dragging: { paneIndex: number; tabIndex: number } | null; splitPreview: "vertical" | "horizontal" | null; }
let dragSnapshot: DragSnapshot = { over: null, dragging: null, splitPreview: null };
const dragListeners = new Set<() => void>();
const subscribeDrag = (cb: () => void) => { dragListeners.add(cb); return () => { dragListeners.delete(cb); }; };
const getDragSnapshot = () => dragSnapshot;
export function useActiveDrag() { return useSyncExternalStore(subscribeDrag, getDragSnapshot); }
function setDrag(next: DragSnapshot) {
  dragSnapshot = next;
  dragListeners.forEach((l) => { try { l(); } catch { /* noop */ } });
}
const sameTarget = (a: TabDropTarget | null, b: TabDropTarget | null) =>
  a === b || (!!a && !!b && a.paneIndex === b.paneIndex && a.tabIndex === b.tabIndex && a.side === b.side);

/** Pointer position -> drop target over any tab in any strip, or null.
 *  Vertically the surrounding strip counts, and a small horizontal slack
 *  bridges the gaps between tabs: pill-styled tabs (LCARS) neither fill the
 *  strip height nor sit flush against each other, so exact-rect testing let
 *  drops between/above the pills fall through to the append-at-end fallback. */
const HIT_SLACK_X = 4;
export function hitTestTabs(x: number, y: number): TabDropTarget | null {
  if (typeof document === "undefined") return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${TAB_ATTR}]`))) {
    const r = el.getBoundingClientRect();
    const strip = el.closest<HTMLElement>(`[${STRIP_ATTR}]`)?.getBoundingClientRect();
    const yOk = strip ? y >= strip.top && y <= strip.bottom : y >= r.top && y <= r.bottom;
    if (!yOk || x < r.left - HIT_SLACK_X || x > r.right + HIT_SLACK_X) continue;
    const side: "before" | "after" = x - r.left < r.width / 2 ? "before" : "after";
    return { paneIndex: Number(el.getAttribute(PANE_ATTR)), tabIndex: Number(el.getAttribute(TAB_ATTR)), side };
  }
  return null;
}

function hitTestStrip(x: number, y: number): number | null {
  if (typeof document === "undefined") return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${STRIP_ATTR}]`))) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(el.getAttribute(STRIP_ATTR));
  }
  return null;
}

export function hitTestSplitPreview(x: number, y: number): "vertical" | "horizontal" | null {
  if (typeof document === "undefined") return null;
  const main = document.querySelector('main');
  if (!main) return null;
  const sections = main.querySelectorAll('section');
  if (sections.length >= 2) return null; // already split

  const rect = main.getBoundingClientRect();
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    const edgeThreshold = 80;
    if (rect.right - x < edgeThreshold) return "vertical";
    if (rect.bottom - y < edgeThreshold) return "horizontal";
  }
  return null;
}

/** Drop target -> insertion index passed to moveTab (dropping on the right half inserts after). */
export function dropIndexFor(target: TabDropTarget): number {
  return target.tabIndex + (target.side === "after" ? 1 : 0);
}

/**
 * Pointer drag for one tab strip. Tabs arm on pointerdown, start dragging past a
 * 5px threshold, hit-test the DOM on move, and on drop call `onMoveTab` (same
 * signature the layout's moveTab expects — cross-pane and same-pane reorders
 * share one path). The click that follows a real drag is suppressed so dropping
 * never also re-selects the tab.
 */
export function useTabDnd(
  paneIndex: number, 
  onMoveTab: (fP: number, fI: number, tP: number, tI: number | null) => void,
  onSplitWithTab?: (direction: "vertical" | "horizontal", fP: number, fI: number) => void
) {
  const drag = useSyncExternalStore(subscribeDrag, getDragSnapshot);
  const suppressClick = useRef(false);

  const endDrag = useCallback(() => {
    activeDrag = null;
    if (dragSnapshot.over || dragSnapshot.dragging || dragSnapshot.splitPreview) setDrag({ over: null, dragging: null, splitPreview: null });
  }, []);

  const tabHandlers = useCallback((tabIndex: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Do NOT capture the pointer here: capturing on press retargets the ensuing
      // click to this tab, which swallows clicks on the close (X) button. Capture
      // only once a real drag starts (past the threshold in pointermove).
      activeDrag = { paneIndex, tabIndex, startX: e.clientX, startY: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!activeDrag) return;
      if (!activeDrag.moved) {
        if (Math.hypot(e.clientX - activeDrag.startX, e.clientY - activeDrag.startY) < DRAG_THRESHOLD_PX) return;
        activeDrag.moved = true;
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      }
      const over = hitTestTabs(e.clientX, e.clientY);
      let splitPreview: "vertical" | "horizontal" | null = null;
      if (!over) {
        splitPreview = hitTestSplitPreview(e.clientX, e.clientY);
      }
      const dragging = { paneIndex: activeDrag.paneIndex, tabIndex: activeDrag.tabIndex };
      if (!sameTarget(over, dragSnapshot.over) || !dragSnapshot.dragging || dragSnapshot.splitPreview !== splitPreview) {
        setDrag({ over, dragging, splitPreview });
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const active = activeDrag;
      const snap = dragSnapshot;
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
      if (!active || !active.moved) { endDrag(); return; }
      suppressClick.current = true;
      const over = hitTestTabs(e.clientX, e.clientY);
      const strip = over ? null : hitTestStrip(e.clientX, e.clientY);
      endDrag();
      if (over) onMoveTab(active.paneIndex, active.tabIndex, over.paneIndex, dropIndexFor(over));
      else if (onSplitWithTab && snap.splitPreview) onSplitWithTab(snap.splitPreview, active.paneIndex, active.tabIndex);
      else if (strip != null) onMoveTab(active.paneIndex, active.tabIndex, strip, null);
    },
    onPointerCancel: () => { endDrag(); },
    // The click fired right after a drag's pointerup must not re-select the tab.
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); e.stopPropagation(); }
    },
  }), [paneIndex, onMoveTab, onSplitWithTab, endDrag]);

  const isDragging = (tabIndex: number) => !!drag.dragging && drag.dragging.paneIndex === paneIndex && drag.dragging.tabIndex === tabIndex;

  return { tabHandlers, over: drag.over, isDragging };
}

/** Inset box-shadow marking the drop position on a hovered tab, or `undefined`
 *  so the tab carries NO inline box-shadow at rest. The active-tab underline is
 *  a stylesheet rule (`.tabstrip [role="tab"][aria-selected="true"]`) — themes
 *  restyle it there without also killing this drag indicator (the LCARS pills
 *  used to blanket-neutralise the shared inline shadow, which made tab drags
 *  look dead). */
export function dropIndicatorShadow(over: TabDropTarget | null, paneIndex: number, tabIndex: number): string | undefined {
  if (!over || over.paneIndex !== paneIndex || over.tabIndex !== tabIndex) return undefined;
  return over.side === "before"
    ? "inset 2px 0 0 0 var(--accent-color)"
    : "inset -2px 0 0 0 var(--accent-color)";
}
