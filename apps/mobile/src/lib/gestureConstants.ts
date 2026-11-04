import { Capacitor } from "@capacitor/core";

/**
 * The numbers every touch gesture in the app shares (plan Kalender 2026-09-10,
 * P4). They lived inside SwipeRow; the calendar's page swipe uses the same
 * dead zone, and one gesture engine with two copies of its threshold is how a
 * later tweak lands on one surface and not the other.
 */

/** Below this the finger is still deciding between scrolling and swiping. */
export const SWIPE_SLOP = 10;

/**
 * The strip along the left edge that belongs to "back": the system's gesture
 * on Android, the app's own on iOS (W5, 2026-10-29). A swipe row or the
 * calendar's page swipe that STARTS here leaves it to back.
 */
export const BACK_EDGE_PX = 24;

/** Whether a touch starting at `clientX` (in a surface whose left edge is `left`) belongs to back. */
export function startsInBackEdge(clientX: number, left = 0): boolean {
  const platform = Capacitor.getPlatform();
  return (platform === "android" || platform === "ios") && clientX - left < BACK_EDGE_PX;
}
