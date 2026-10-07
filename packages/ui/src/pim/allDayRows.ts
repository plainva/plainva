/**
 * How much of the all-day row a time grid shows (decision E8, plan Befunde
 * 2026-10-06, K2).
 *
 * The row used to be capped at a fixed height with a scrollbar nobody could
 * see: a multi-day bar, a working location, an appointment and a task filled
 * it, and the fifth entry was simply not there. Now the row grows on its own
 * up to `ALL_DAY_MAX_ROWS` rows. A day with more gives its last row to a
 * count ("+ 2 more"); one click opens the row for every day at once, and the
 * same place offers the way back.
 *
 * A row is one lane of multi-day bars or one single entry (a status band, an
 * all-day appointment, a task, a database entry). The lanes are shared by all
 * days of the grid — a bar spans columns — so they come first in every day,
 * whether or not a bar crosses it.
 */

export const ALL_DAY_MAX_ROWS = 5;

export interface AllDayBarLike {
  lane: number;
  startCol: number;
  endCol: number;
}

export interface AllDayDayPlan {
  /** How many of the day's own entries are drawn, in their order. */
  visibleItems: number;
  /** What the day's count says: hidden entries plus hidden bars crossing it. */
  hidden: number;
}

export interface AllDayPlan {
  /** Some day holds more than fits — the row can be opened and closed. */
  overflow: boolean;
  /** Lanes of multi-day bars that are drawn; bars in later lanes are counted. */
  visibleLanes: number;
  days: AllDayDayPlan[];
}

export function planAllDayRows(input: {
  /** Lanes the multi-day bars need (shared by every day). */
  laneCount: number;
  bars: readonly AllDayBarLike[];
  /** Per day: its own entries below the bars. */
  itemCounts: readonly number[];
  expanded: boolean;
  maxRows?: number;
}): AllDayPlan {
  const max = Math.max(2, input.maxRows ?? ALL_DAY_MAX_ROWS);
  const overflow = input.itemCounts.some((items) => input.laneCount + items > max);
  if (!overflow || input.expanded) {
    return { overflow, visibleLanes: input.laneCount, days: input.itemCounts.map((items) => ({ visibleItems: items, hidden: 0 })) };
  }
  // The last row of an overflowing day belongs to its count.
  const visibleLanes = Math.min(input.laneCount, max - 1);
  const days = input.itemCounts.map((items, col) => {
    const hiddenBars = input.bars.filter((b) => b.lane >= visibleLanes && b.startCol <= col && b.endCol >= col).length;
    if (hiddenBars === 0 && input.laneCount + items <= max) return { visibleItems: items, hidden: 0 };
    const visibleItems = Math.min(items, max - 1 - visibleLanes);
    return { visibleItems, hidden: hiddenBars + items - visibleItems };
  });
  return { overflow, visibleLanes, days };
}

/**
 * The month grid of the phone: a day shows at most `shown` dots, and says how
 * many entries lie beyond them. 0 = everything is on screen.
 */
export function hiddenBeyondDots(count: number, shown: number): number {
  return Math.max(0, count - shown);
}
