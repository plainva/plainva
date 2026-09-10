/**
 * The numbers every touch gesture in the app shares (plan Kalender 2026-09-10,
 * P4). They lived inside SwipeRow; the calendar's page swipe uses the same
 * dead zone, and one gesture engine with two copies of its threshold is how a
 * later tweak lands on one surface and not the other.
 */

/** Below this the finger is still deciding between scrolling and swiping. */
export const SWIPE_SLOP = 10;
