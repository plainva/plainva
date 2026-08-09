/**
 * A multi-day event is ONE element, not a chain (S5).
 *
 * The data was never the problem: `eventDayKeys` has always returned every day
 * an event touches, and the buckets have always been right. What was missing is
 * a layer that asks, per week row, which event runs across which columns — so a
 * three-day trip is drawn once, labelled once, and clicked once, instead of
 * appearing three times as three unrelated chips that know nothing about each
 * other.
 *
 * This is the part that is pure, and therefore the part both shells share: the
 * lane assignment, the column range and, crucially, WHERE the bar is cut. A bar
 * that leaves the week is clipped at the edge and continues in the next row
 * without repeating its title — repeating it is exactly the "chain" this step
 * exists to end.
 */

export interface SpanBar<T> {
  event: T;
  /** Vertical lane inside the week row; 0 is the topmost. Bars in one lane never overlap. */
  lane: number;
  /** First and last column of this week row the bar covers, both inclusive, 0-based. */
  startCol: number;
  endCol: number;
  /** The event already ran before this row — draw a flat left edge, no title. */
  clippedStart: boolean;
  /** The event continues after this row — draw a flat right edge. */
  clippedEnd: boolean;
}

export interface SpanLayout<T> {
  bars: SpanBar<T>[];
  /** How many lanes the row needs; 0 when nothing spans. The caller reserves the space. */
  laneCount: number;
  /** Every event drawn as a bar, so the caller does not ALSO draw it as a day chip. */
  spanned: Set<T>;
}

export interface SpanOptions<T> {
  /** Every day key the event touches, in ascending order — `eventDayKeys` in both shells. */
  keysOf: (event: T) => readonly string[];
  /**
   * How many days an event must cover before it becomes a bar. Two by default:
   * a single day is not a span, and drawing it as one would turn every ordinary
   * appointment into a bar the reader has to decode.
   */
  minDays?: number;
  /** Stable ordering inside a lane; longer bars first keeps the layout calm. */
  compare?: (a: T, b: T) => number;
}

/**
 * Lays out the multi-day events of ONE week row.
 *
 * `weekDays` are the row's day keys in display order (7 for a month row, but a
 * three-day view row works just as well — the helper never assumes seven).
 */
export function layoutSpanningEvents<T>(weekDays: readonly string[], events: readonly T[], opts: SpanOptions<T>): SpanLayout<T> {
  const minDays = opts.minDays ?? 2;
  const index = new Map<string, number>();
  weekDays.forEach((k, i) => index.set(k, i));

  type Candidate = { event: T; startCol: number; endCol: number; clippedStart: boolean; clippedEnd: boolean; span: number };
  const candidates: Candidate[] = [];

  // One event, one bar — however often the caller hands it over. The all-day
  // strip passes a per-day bucket, so a five-day trip arrives five times; a bar
  // per copy would rebuild exactly the chain this replaces.
  const seen = new Set<T>();

  for (const event of events) {
    if (seen.has(event)) continue;
    seen.add(event);
    const keys = opts.keysOf(event);
    if (keys.length < minDays) continue;

    // Where the event meets THIS row. It may start before and end after it —
    // that is the normal case for a long trip, and the reason the flags exist.
    let startCol = -1;
    let endCol = -1;
    for (const k of keys) {
      const col = index.get(k);
      if (col === undefined) continue;
      if (startCol === -1 || col < startCol) startCol = col;
      if (col > endCol) endCol = col;
    }
    if (startCol === -1) continue;

    const firstKey = keys[0];
    const lastKey = keys[keys.length - 1];
    candidates.push({
      event,
      startCol,
      endCol,
      // Clipped when the event's own first/last day is not the one we drew.
      clippedStart: index.get(firstKey) !== startCol,
      clippedEnd: index.get(lastKey) !== endCol,
      span: keys.length,
    });
  }

  // Longest first, then by starting column: a calm, deterministic order that
  // keeps the long bar on top rather than letting it hop lanes between renders.
  candidates.sort((a, b) => b.span - a.span || a.startCol - b.startCol || (opts.compare ? opts.compare(a.event, b.event) : 0));

  const lanes: Array<Array<{ startCol: number; endCol: number }>> = [];
  const bars: SpanBar<T>[] = [];
  const spanned = new Set<T>();

  for (const c of candidates) {
    let lane = lanes.findIndex((taken) => taken.every((t) => c.endCol < t.startCol || c.startCol > t.endCol));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push({ startCol: c.startCol, endCol: c.endCol });
    bars.push({ event: c.event, lane, startCol: c.startCol, endCol: c.endCol, clippedStart: c.clippedStart, clippedEnd: c.clippedEnd });
    spanned.add(c.event);
  }

  return { bars, laneCount: lanes.length, spanned };
}

/**
 * Splits a flat list of cells into rows of `perRow` — the month grid hands the
 * helper one week at a time, and this is how it gets them.
 */
export function chunkWeeks<T>(cells: readonly T[], perRow = 7): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cells.length; i += perRow) out.push(cells.slice(i, i + perRow));
  return out;
}
