import { useCallback, useRef, type WheelEvent as ReactWheelEvent } from "react";

/**
 * The desktop's counterpart to the phone's page swipe (plan Kalender,
 * Anker-Links, Dependabot 2026-09-10, P4, decision E4): a horizontal wheel —
 * a two-finger swipe on a trackpad, Shift + mouse wheel — over the calendar
 * pages to the neighbouring period, exactly what the arrows do. One page per
 * gesture: a trackpad swipe arrives as a burst of wheel events, so after a
 * page the handler stays quiet for a moment instead of running three months.
 *
 * Nothing on the desktop calendar scrolls sideways, so the wheel has no other
 * claimant here and the handler never calls preventDefault.
 */

/** Below this a horizontal delta is noise from a mostly vertical scroll. */
export const PAGE_WHEEL_MIN_DX = 40;
/** After a page, the burst of the same swipe is ignored for this long. */
export const PAGE_WHEEL_COOLDOWN_MS = 400;

export function usePageWheel(onPage: (dir: -1 | 1) => void) {
  const last = useRef(0);
  return useCallback(
    (e: ReactWheelEvent<HTMLElement>) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < PAGE_WHEEL_MIN_DX) return;
      const now = e.timeStamp;
      if (now - last.current < PAGE_WHEEL_COOLDOWN_MS) return;
      last.current = now;
      onPage(e.deltaX > 0 ? 1 : -1);
    },
    [onPage]
  );
}
