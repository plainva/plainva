import { describe, expect, it } from "vitest";
import { chunkWeeks, layoutSpanningEvents } from "@plainva/ui";

/** A week Mon–Sun; the helper never assumes seven, but the month grid does. */
const WEEK = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
const NEXT = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];

interface Ev {
  id: string;
  days: string[];
}
const ev = (id: string, days: string[]): Ev => ({ id, days });
const keysOf = (e: Ev) => e.days;

describe("layoutSpanningEvents", () => {
  it("draws a three-day event once, across its columns", () => {
    const trip = ev("trip", ["2026-08-04", "2026-08-05", "2026-08-06"]);
    const out = layoutSpanningEvents(WEEK, [trip], { keysOf });
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0]).toMatchObject({ event: trip, lane: 0, startCol: 1, endCol: 3, clippedStart: false, clippedEnd: false });
    expect(out.laneCount).toBe(1);
    // The caller must not ALSO draw it as a chip — that is the chain we are ending.
    expect(out.spanned.has(trip)).toBe(true);
  });

  it("leaves a single-day event alone", () => {
    const one = ev("standup", ["2026-08-05"]);
    const out = layoutSpanningEvents(WEEK, [one], { keysOf });
    expect(out.bars).toHaveLength(0);
    expect(out.laneCount).toBe(0);
    expect(out.spanned.has(one)).toBe(false);
  });

  it("cuts at the week boundary and continues without a title in the next row", () => {
    // Fri to Tue: two rows, and only the FIRST carries the label.
    const long = ev("conf", ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11"]);
    const first = layoutSpanningEvents(WEEK, [long], { keysOf });
    const second = layoutSpanningEvents(NEXT, [long], { keysOf });

    expect(first.bars[0]).toMatchObject({ startCol: 4, endCol: 6, clippedStart: false, clippedEnd: true });
    expect(second.bars[0]).toMatchObject({ startCol: 0, endCol: 1, clippedStart: true, clippedEnd: false });
  });

  it("stacks overlapping bars into lanes and reuses a lane where there is room", () => {
    const a = ev("a", ["2026-08-03", "2026-08-04", "2026-08-05"]);
    const b = ev("b", ["2026-08-04", "2026-08-05", "2026-08-06"]);
    const c = ev("c", ["2026-08-07", "2026-08-08"]);
    const out = layoutSpanningEvents(WEEK, [a, b, c], { keysOf });

    const lane = (id: string) => out.bars.find((x) => x.event.id === id)!.lane;
    expect(lane("a")).not.toBe(lane("b")); // they overlap
    expect(lane("c")).toBe(0); // starts after `a` ends, so lane 0 is free again
    expect(out.laneCount).toBe(2);
  });

  it("ignores an event that does not touch this row at all", () => {
    const elsewhere = ev("later", ["2026-08-20", "2026-08-21"]);
    expect(layoutSpanningEvents(WEEK, [elsewhere], { keysOf }).bars).toHaveLength(0);
  });

  it("puts the longer bar on top, deterministically", () => {
    const short = ev("short", ["2026-08-04", "2026-08-05"]);
    const long = ev("long", ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]);
    // Order of the input must not decide the picture.
    const a = layoutSpanningEvents(WEEK, [short, long], { keysOf });
    const b = layoutSpanningEvents(WEEK, [long, short], { keysOf });
    const laneOf = (o: typeof a, id: string) => o.bars.find((x) => x.event.id === id)!.lane;
    expect(laneOf(a, "long")).toBe(0);
    expect(laneOf(b, "long")).toBe(0);
    expect(laneOf(a, "short")).toBe(laneOf(b, "short"));
  });

  it("respects a raised minDays", () => {
    const two = ev("two", ["2026-08-04", "2026-08-05"]);
    expect(layoutSpanningEvents(WEEK, [two], { keysOf, minDays: 3 }).bars).toHaveLength(0);
  });
});

describe("chunkWeeks", () => {
  it("splits the month cells into week rows", () => {
    const cells = Array.from({ length: 42 }, (_, i) => i);
    const weeks = chunkWeeks(cells);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weeks[5][6]).toBe(41);
  });

  it("keeps a short final row rather than padding it", () => {
    expect(chunkWeeks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe("layoutSpanningEvents · duplicates", () => {
  // The all-day strip hands over a per-day bucket, so the same event arrives
  // once per day it covers. One event must still be one bar.
  it("draws one bar even when the same event is passed once per day", () => {
    const trip = ev("trip", ["2026-08-04", "2026-08-05", "2026-08-06"]);
    const out = layoutSpanningEvents(WEEK, [trip, trip, trip], { keysOf });
    expect(out.bars).toHaveLength(1);
    expect(out.laneCount).toBe(1);
  });
});
