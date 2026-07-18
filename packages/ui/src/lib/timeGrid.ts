/**
 * Pure time-grid math shared by the desktop and mobile calendars (feedback
 * round 3): laying overlapping timed events into side-by-side lanes and the
 * pixel↔minute conversions the day/week columns use for positioning blocks
 * and for click/drag event creation. No DOM, no framework — unit tested.
 */

/** Minimal timed-event shape the grid positions. Timestamps are local ms. */
export interface TimeGridEvent {
  startMs: number;
  endMs: number;
}

/** A timed event placed into a lane (column) among its overlapping neighbours. */
export interface LaidOutEvent<T extends TimeGridEvent> {
  event: T;
  /** 0-based lane within the event's overlap cluster. */
  lane: number;
  /** Total lanes in that cluster — divide the column width by this. */
  lanes: number;
}

/** Point events get a 1 ms sliver so simultaneous starts still overlap. */
function effectiveEnd(e: TimeGridEvent): number {
  return Math.max(e.endMs, e.startMs + 1);
}

/**
 * Assign overlapping timed events to side-by-side lanes (greedy interval-graph
 * colouring). Events are grouped into clusters of transitive overlap; within a
 * cluster each event takes the lowest lane whose previous event has already
 * ended, and every event in the cluster reports the cluster's lane count so the
 * caller divides the column width evenly. Deterministic: sorted by start, then
 * end, then the optional stable key.
 */
export function layoutDayEvents<T extends TimeGridEvent>(events: T[], keyOf?: (e: T) => string): LaidOutEvent<T>[] {
  const sorted = [...events].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (keyOf ? keyOf(a).localeCompare(keyOf(b)) : 0)
  );
  const out: LaidOutEvent<T>[] = [];
  let cluster: { event: T; lane: number }[] = [];
  let clusterMaxEnd = -Infinity;
  let laneEnds: number[] = []; // effectiveEnd of the last event in each lane

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const c of cluster) out.push({ event: c.event, lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
    clusterMaxEnd = -Infinity;
  };

  for (const e of sorted) {
    if (cluster.length > 0 && e.startMs >= clusterMaxEnd) flush();
    // Lowest lane whose previous event has ended by this event's start.
    let lane = laneEnds.findIndex((end) => end <= e.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(effectiveEnd(e));
    } else {
      laneEnds[lane] = effectiveEnd(e);
    }
    cluster.push({ event: e, lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, effectiveEnd(e));
  }
  flush();
  return out;
}

const DAY_MINUTES = 24 * 60;

/** Local-midnight ms of the civil day containing `ms`. */
export function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Minutes from the given day's local midnight, clamped to [0, 1440]. */
export function minutesInDay(ms: number, dayStartMs: number): number {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round((ms - dayStartMs) / 60000)));
}

/** Snap a minute value to the nearest `step` (default 15), clamped to the day. */
export function snapMinutes(min: number, step = 15): number {
  const snapped = Math.round(min / step) * step;
  return Math.max(0, Math.min(DAY_MINUTES, snapped));
}

/** Pixel offset within the grid → minute of day, given the row height per hour. */
export function pxToMinutes(px: number, pxPerHour: number): number {
  if (pxPerHour <= 0) return 0;
  return Math.max(0, Math.min(DAY_MINUTES, (px / pxPerHour) * 60));
}

/** Minute of day → pixel offset within the grid. */
export function minutesToPx(min: number, pxPerHour: number): number {
  return (min / 60) * pxPerHour;
}

/** "HH:MM" (24h, zero-padded) for a minute-of-day value. */
export function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
