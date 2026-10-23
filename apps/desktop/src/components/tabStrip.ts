import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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

/* ------------------------------------------------------------ overflow */

/**
 * The floor a tab shrinks to once the strip is full. Below it the label is gone
 * and what is left — an icon and a ✕ — is not a tab any more, it is a guess. A
 * tab whose whole content is narrower never grows to it.
 */
export const TAB_MIN_WIDTH = 104;
/** The most a tab may be wide: a longer name is cut short (the full one is its `data-tip`). */
export const TAB_MAX_WIDTH = 220;
/** Room the overflow button needs at the end of the strip, until it has been measured. */
const OVERFLOW_WIDTH = 44;

/**
 * Which tabs the strip shows, and which go behind the overflow button (E13).
 *
 * A tab is as wide as what it holds — pin, icon, name, ✕ — up to
 * `TAB_MAX_WIDTH`. The strip lays them out as a grid of `minmax(0, max-content)`
 * columns (`.tabstrip` in ui.css): while there is room each tab takes its own
 * width, and once the strip is full the room is shared EQUALLY, so short names
 * stay whole and the long ones are cut short first. Every tab used to take an
 * equal share of the strip and never less than the floor: a tab named "index"
 * stood with an empty stretch after its ✕, while a long name beside it was cut
 * with room to spare (finding 2026-10-23).
 *
 * What does not fit then goes behind one button, never under a scrollbar: at
 * eight tabs one used to appear under the strip, a control nobody looks for
 * there, which put a tab a drag away instead of a click (finding 2026-09-22).
 * A tab is in the window while every tab there can keep at least
 * min(its own width, `TAB_MIN_WIDTH`), and the active tab always is.
 *
 * There is no upper limit and nothing closes itself: a tab Plainva shuts on
 * its own is a lost train of thought.
 */
export function tabWindowOf(
  needs: readonly number[],
  activeIndex: number,
  room: number,
  overflowRoom = OVERFLOW_WIDTH,
): { start: number; count: number; hidden: number[] } {
  const total = needs.length;
  // Before the first measurement everything is shown: a strip that starts by
  // hiding tabs and then reveals them flickers on every window open.
  if (room <= 0 || needs.reduce((sum, n) => sum + n, 0) <= room) return { start: 0, count: total, hidden: [] };
  const budget = room - overflowRoom;
  // The window stays at the front while the active tab is in it, and otherwise
  // ends at the active tab and reaches back as far as it can — the least it can
  // move. Derived, so no state can disagree with the props. Never fewer than one.
  let start = 0;
  let end = 0;
  let used = 0;
  while (end < total && used + needs[end] <= budget) used += needs[end++];
  end = Math.max(end, Math.min(1, total));
  const active = Math.min(Math.max(activeIndex, 0), total - 1);
  if (active >= end) {
    start = active;
    end = active + 1;
    used = needs[active];
    while (start > 0 && used + needs[start - 1] <= budget) used += needs[--start];
  }
  const hidden: number[] = [];
  for (let i = 0; i < total; i++) if (i < start || i >= end) hidden.push(i);
  return { start, count: end - start, hidden };
}

/** How much room a tab has to have before it goes behind the overflow button. */
export function tabNeed(naturalWidth: number | undefined, extra: number): number {
  return Math.min(naturalWidth ?? TAB_MIN_WIDTH, TAB_MIN_WIDTH) + extra;
}

interface TabMeasure {
  /** Width each tab would take with nothing cut, by path (a tab out of sight keeps its last one). */
  natural: ReadonlyMap<string, number>;
  /** What every tab costs beside its own box: its margins and the strip's gap. */
  extra: number;
  /** The overflow button with its margins, once it has been on screen. */
  more: number;
}
const NO_MEASURE: TabMeasure = { natural: new Map(), extra: 0, more: OVERFLOW_WIDTH };

const px = (v: string) => parseFloat(v) || 0;

/**
 * The window of a strip, measured. `strip` is the strip element; `slack`, where
 * the strip sits in a row with a filler after it (the title bar), is that
 * filler — the room the strip could still grow into. Both are elements held in
 * state (callback refs): the title-bar strip only exists while there are tabs,
 * and a ref read once at mount measured nothing for the rest of the window's
 * life — the title bar never overflowed after a start without tabs.
 */
export function useTabWindow(
  strip: HTMLElement | null,
  slack: HTMLElement | null,
  tabs: readonly string[],
  activeIndex: number,
  pinned?: readonly boolean[],
): { start: number; count: number; hidden: number[] } {
  // A tab is measured by its path AND its pin: a path can be open twice, once
  // pinned and once not, and the two differ by the pin glyph. Keyed by path
  // alone, whichever copy was in the window set the width the window was
  // chosen by, and the window flipped between the two for good.
  const keys = tabs.map((path, i) => (pinned?.[i] ? "pinned:" : "tab:") + path);
  const [room, setRoom] = useState(0);
  // Bumped whenever a tab changes size on its own — a theme, a late font —
  // so the tabs are measured again even when the strip's room stays the same.
  const [resized, setResized] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    if (!strip) return;
    const measure = () => {
      // Fractional on both sides: strip and filler add up to a constant, and
      // a whole-pixel strip beside a fractional filler would not — the error
      // would depend on which tabs are shown and could flip the window.
      const cs = getComputedStyle(strip);
      let next = strip.getBoundingClientRect().width
        - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
      if (slack) next += Math.max(0, slack.getBoundingClientRect().width - px(getComputedStyle(slack).minWidth));
      setRoom(Math.max(0, next));
    };
    measure();
    // Not every environment has one — jsdom does not, and a strip that throws
    // there would take the whole window's test down with it. The window's own
    // resize is a coarser but sufficient fallback.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(() => { measure(); setResized((n) => n + 1); });
    ro.observe(strip);
    if (slack) ro.observe(slack);
    observer.current = ro;
    return () => { ro.disconnect(); observer.current = null; observed.current = new Set(); };
  }, [strip, slack]);

  const [measure, setMeasure] = useState<TabMeasure>(NO_MEASURE);
  const needs = keys.map((key) => tabNeed(measure.natural.get(key), measure.extra));
  const tabWindow = tabWindowOf(needs, activeIndex, room, measure.more);

  // What each tab holds is read from the tabs on screen: whenever the tabs or
  // the window change, and whenever a tab changes size by itself (a pin, the
  // theme, a late font — the observer above sees every tab on screen). Only a
  // change of more than a pixel counts, so sub-pixel rounding cannot keep it going.
  useLayoutEffect(() => {
    if (!strip) return;
    const natural = new Map<string, number>();
    for (const key of keys) {
      const known = measure.natural.get(key);
      if (known !== undefined) natural.set(key, known);
    }
    let changed = natural.size !== measure.natural.size;
    let extra = measure.extra;
    const gap = px(getComputedStyle(strip).columnGap);
    // Two tabs with one key hold the same; should they still differ, the wider
    // one counts, so neither overwrites the other on every pass.
    const widest = new Map<string, number>();
    const onScreen = new Set<HTMLElement>();
    for (const el of Array.from(strip.querySelectorAll<HTMLElement>(`[${TAB_ATTR}]`))) {
      const key = keys[Number(el.getAttribute(TAB_ATTR))];
      if (key === undefined) continue;
      onScreen.add(el);
      const box = el.getBoundingClientRect().width;
      const label = el.querySelector<HTMLElement>(".tabstrip-label");
      // The tab with its name whole: the label's box swapped for its text's
      // width — read from a Range, because clientWidth and scrollWidth are
      // whole pixels and their error adds up over a strip of tabs.
      // (jsdom has Ranges without a box; there the label's scrollWidth stands in.)
      let width = box;
      if (label) {
        const text = document.createRange();
        text.selectNodeContents(label);
        const whole = typeof text.getBoundingClientRect === "function" ? text.getBoundingClientRect().width : label.scrollWidth;
        width = box - label.getBoundingClientRect().width + whole;
      }
      widest.set(key, Math.max(width + 0.5, widest.get(key) ?? 0));
      const cs = getComputedStyle(el);
      const own = px(cs.marginLeft) + px(cs.marginRight) + gap;
      if (Math.abs(own - extra) > 0.5) { extra = own; changed = true; }
    }
    for (const [key, width] of widest) {
      const was = natural.get(key);
      if (was === undefined || Math.abs(was - width) > 1) { natural.set(key, width); changed = true; }
    }
    // Watch the tabs on screen, and only those: a tab that left the window or
    // closed is let go, so the observer does not collect them all session long.
    const ro = observer.current;
    if (ro) {
      for (const el of observed.current) if (!onScreen.has(el)) ro.unobserve(el);
      for (const el of onScreen) if (!observed.current.has(el)) ro.observe(el);
      observed.current = onScreen;
    }
    let more = measure.more;
    const button = strip.querySelector<HTMLElement>(".tabstrip-more");
    if (button) {
      const cs = getComputedStyle(button);
      const width = Math.ceil(button.getBoundingClientRect().width + px(cs.marginLeft) + px(cs.marginRight) + gap);
      if (Math.abs(width - more) > 1) { more = width; changed = true; }
    }
    if (changed) setMeasure({ natural, extra, more });
  }, [strip, keys, measure, resized, tabWindow.start, tabWindow.count]);

  return tabWindow;
}
