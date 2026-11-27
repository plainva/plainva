/**
 * After how many milliseconds without activity the sync worker's watchdog gives
 * a cycle up. A module of its own, so a surface that names these minutes does
 * not pull the whole worker into the start bundle.
 */
export const CYCLE_STALE_ABANDON_MS = 15 * 60 * 1000;
/**
 * After how many minutes without activity the watchdog gives a cycle up —
 * the minutes the notice of a stuck sync names (`stuck`), from the same
 * number as the watchdog.
 */
export const SYNC_STUCK_AFTER_MINUTES = CYCLE_STALE_ABANDON_MS / 60_000;
