import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { BACK_EDGE_PX, SWIPE_SLOP } from "./gestureConstants";
import { openSheetCount } from "../services/sheetStack";

/** Past this share of the width a release goes back. */
export const EDGE_BACK_RATIO = 0.35;
/** A flick faster than this goes back regardless of distance (px per ms). */
export const EDGE_BACK_FLICK = 0.5;
/** The page leaves in this time before the step is taken; the CSS uses --dur-2 for it. */
const LEAVE_FALLBACK_MS = 320;

/** Whether a release at `dx` (moved this fast) takes the step back. */
export function edgeSwipeCommits(dx: number, width: number, velocity: number): boolean {
  if (dx <= 0) return false;
  return dx > width * EDGE_BACK_RATIO || (dx > SWIPE_SLOP * 2 && velocity > EDGE_BACK_FLICK);
}

/**
 * Back from the left edge on the iPhone and iPad (wish TestFlight 2026-10-25,
 * W5; decided 2026-10-29). Android has the system's back gesture on the same
 * edge, which already pops the same stack, so this runs on iOS only.
 *
 * Only a touch that STARTS in the first BACK_EDGE_PX takes part, so swipe rows
 * and the calendar's page swipe keep the rest of the width; they leave this
 * strip alone in turn (`startsInBackEdge`). The working column follows the
 * finger; a release past a third of the width (or a flick) lets it slide out
 * and then takes the same step the app bar's arrow takes, through `onBack`.
 * An open sheet is navigation state of its own: no gesture while one is up.
 */
export function useEdgeSwipeBack({
  enabled,
  target,
  onBack,
}: {
  enabled: boolean;
  target: () => HTMLElement | null;
  onBack: () => void;
}): void {
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() !== "ios") return;
    let start: { x: number; y: number; t: number } | null = null;
    let claimed = false;
    let node: HTMLElement | null = null;
    const reset = () => {
      node?.classList.remove("is-edge-dragging");
      node?.style.removeProperty("--m-edge-dx");
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || openSheetCount() > 0) return;
      const touch = e.touches[0];
      if (touch.clientX > BACK_EDGE_PX) return;
      start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp };
      claimed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!claimed) {
        if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
        if (dx <= SWIPE_SLOP) return;
        claimed = true;
        node = target();
        node?.classList.add("is-edge-dragging");
      }
      e.preventDefault();
      node?.style.setProperty("--m-edge-dx", `${Math.max(0, dx)}px`);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const began = start;
      start = null;
      if (!claimed) return;
      claimed = false;
      const touch = e.changedTouches[0];
      const dx = touch ? touch.clientX - began.x : 0;
      const velocity = dx / Math.max(1, e.timeStamp - began.t);
      const leaving = node;
      const width = leaving?.clientWidth ?? window.innerWidth;
      if (e.type === "touchcancel" || !edgeSwipeCommits(dx, width, velocity)) { reset(); return; }
      leaving?.classList.remove("is-edge-dragging");
      leaving?.classList.add("is-edge-leaving");
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onBack();
        // The step may be refused (a draft asks first): the page comes back.
        window.requestAnimationFrame(() => {
          leaving?.classList.remove("is-edge-leaving");
          leaving?.style.removeProperty("--m-edge-dx");
        });
      };
      leaving?.addEventListener("transitionend", finish, { once: true });
      window.setTimeout(finish, LEAVE_FALLBACK_MS);
    };
    document.addEventListener("touchstart", onStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onMove, { passive: false, capture: true });
    document.addEventListener("touchend", onEnd, { capture: true });
    document.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      reset();
      document.removeEventListener("touchstart", onStart, { capture: true });
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd, { capture: true });
      document.removeEventListener("touchcancel", onEnd, { capture: true });
    };
  }, [enabled, target, onBack]);
}
