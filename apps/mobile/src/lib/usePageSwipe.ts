import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { haptics } from "../services/haptics";
import { SWIPE_SLOP } from "./gestureConstants";

/**
 * A horizontal drag on a calendar page means PAGING (plan Kalender,
 * Anker-Links, Dependabot 2026-09-10, P4): the page follows the finger, and
 * releasing past a quarter of the width — or with a flick — commits to the
 * neighbour, exactly what the arrows do. Below that it springs back.
 *
 * The mechanics are the swipe row's (SwipeRow.tsx), on purpose: the same
 * dead zone, the same axis lock (vertical wins and hands the gesture to the
 * scroller; horizontal claims it with setPointerCapture), the same pointer
 * events. The calendar does not invent a second gesture engine; it gives the
 * same engine a second meaning on a different surface.
 *
 * What the hook refuses, by position: a drag that starts on an element with
 * `data-no-page-swipe` (the overlay chip row scrolls sideways itself; a held
 * event block is being moved), and on Android a drag that starts in the
 * left edge zone the system claims for its back gesture. iOS has no edge
 * back gesture in Plainva (parity catalog `system-back`, 2026-09-01), so the
 * whole width pages there.
 *
 * `touch-action: pan-y` on the surface is the precondition, not a nicety:
 * without it the WebView cancels the drag after two moves (mobile.css, the
 * swipe row's comment). `e2e-prod/swipe-gesture.spec.ts` drives real touch.
 */

/** Past this share of the width the release commits to the neighbour. */
export const PAGE_SWIPE_RATIO = 0.25;
/** A flick faster than this commits regardless of distance (px per ms). */
export const PAGE_SWIPE_FLICK = 0.4;
/** Android's back gesture owns the first pixels of the left edge. */
export const ANDROID_EDGE_PX = 24;
/** The settle animation; 0 under reduced motion. */
export const PAGE_SETTLE_MS = 200;

export interface PageSwipeState {
  /** Horizontal offset of the page in px while the finger drags (0 at rest). */
  offset: number;
  /** True while the page animates to its resting place after a release. */
  settling: boolean;
}

export interface PageSwipeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function usePageSwipe(onCommit: (dir: -1 | 1) => void): [PageSwipeState, PageSwipeHandlers] {
  const [state, setState] = useState<PageSwipeState>({ offset: 0, settling: false });
  const drag = useRef<{ x: number; y: number; t: number; w: number; axis: "" | "x" | "y"; id: number } | null>(null);
  const settleTimer = useRef<number | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (settleTimer.current !== null) return; // still settling — one page at a time
    const el = e.target as HTMLElement | null;
    if (el?.closest("[data-no-page-swipe]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (Capacitor.getPlatform() === "android" && e.clientX - rect.left < ANDROID_EDGE_PX) return;
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, w: Math.max(1, rect.width), axis: "", id: e.pointerId };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.axis === "") {
      if (Math.abs(my) > SWIPE_SLOP && Math.abs(my) > Math.abs(mx)) {
        // Vertical wins: the scroller keeps the gesture.
        drag.current = null;
        return;
      }
      if (Math.abs(mx) < SWIPE_SLOP) return;
      d.axis = "x";
      e.currentTarget.setPointerCapture(d.id);
    }
    setState({ offset: mx, settling: false });
  }, []);

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.axis !== "x") return;
      const mx = e.clientX - d.x;
      const speed = Math.abs(mx) / Math.max(1, e.timeStamp - d.t);
      const commit = Math.abs(mx) >= d.w * PAGE_SWIPE_RATIO || speed >= PAGE_SWIPE_FLICK;
      const dir: -1 | 1 = mx < 0 ? 1 : -1;
      const ms = reducedMotion() ? 0 : PAGE_SETTLE_MS;
      if (commit) haptics.light();
      if (ms === 0) {
        setState({ offset: 0, settling: false });
        if (commit) onCommit(dir);
        return;
      }
      // Slide the rest of the way out (or back). On a commit the new period
      // then enters from the side the finger was moving towards: the content
      // swaps while the page stands just outside, and slides in.
      setState({ offset: commit ? -dir * d.w : 0, settling: true });
      settleTimer.current = window.setTimeout(() => {
        if (!commit) {
          settleTimer.current = null;
          setState({ offset: 0, settling: false });
          return;
        }
        onCommit(dir);
        setState({ offset: dir * d.w, settling: false });
        requestAnimationFrame(() => {
          setState({ offset: 0, settling: true });
          settleTimer.current = window.setTimeout(() => {
            settleTimer.current = null;
            setState({ offset: 0, settling: false });
          }, ms);
        });
      }, ms);
    },
    [onCommit]
  );

  return [state, { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end }];
}
