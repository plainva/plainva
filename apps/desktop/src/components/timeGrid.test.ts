import { describe, expect, it } from "vitest";
import {
  blockHeightPx,
  nextLaneStartMin,
  layoutDayEvents,
  minutesInDay,
  snapMinutes,
  pxToMinutes,
  minutesToPx,
  minutesToHHMM,
  startOfDayMs,
  buildContiguousDays,
  moveEventMinutes,
  resizeEventEndMinutes,
  type TimeGridEvent,
} from "@plainva/ui";

// A fixed civil day so the tests never depend on "now".
const DAY = new Date(2026, 6, 9).getTime(); // 2026-07-09 local midnight
const at = (h: number, m = 0) => DAY + (h * 60 + m) * 60000;
const ev = (startH: number, startM: number, endH: number, endM: number, id = "") => ({
  startMs: at(startH, startM),
  endMs: at(endH, endM),
  id,
});

describe("layoutDayEvents", () => {
  it("gives non-overlapping events a single lane each", () => {
    const out = layoutDayEvents([ev(9, 0, 10, 0), ev(11, 0, 12, 0)]);
    expect(out.every((o) => o.lanes === 1 && o.lane === 0)).toBe(true);
  });

  it("places two overlapping events side by side", () => {
    const out = layoutDayEvents([ev(9, 0, 10, 30), ev(9, 30, 10, 0)]);
    expect(out.map((o) => o.lanes)).toEqual([2, 2]);
    expect(new Set(out.map((o) => o.lane))).toEqual(new Set([0, 1]));
  });

  it("reuses a lane once the earlier event has ended", () => {
    // A 9–10 and B 9:30–10:30 overlap (2 lanes); C 10:30–11 reuses lane 0.
    const out = layoutDayEvents([ev(9, 0, 10, 0, "a"), ev(9, 30, 10, 30, "b"), ev(10, 30, 11, 0, "c")]);
    const byId = Object.fromEntries(out.map((o) => [(o.event as { id: string }).id, o]));
    expect(byId.a.lane).toBe(0);
    expect(byId.b.lane).toBe(1);
    expect(byId.c.lane).toBe(0);
    // a and b are in a 2-lane cluster; c starts a fresh 1-lane cluster.
    expect(byId.a.lanes).toBe(2);
    expect(byId.c.lanes).toBe(1);
  });

  it("treats simultaneous point events as overlapping (side by side)", () => {
    const out = layoutDayEvents([ev(16, 0, 16, 0, "p1"), ev(16, 0, 16, 0, "p2")]);
    expect(out.map((o) => o.lanes)).toEqual([2, 2]);
  });

  it("keeps two touching events at full width — an end at 11:00 is not an overlap with a start at 11:00", () => {
    // Reported 2026-09-04 as "shown as overlapping"; the lanes were right all
    // along (this pins it), the missing piece was the span below.
    const out = layoutDayEvents([ev(9, 0, 11, 0, "a"), ev(11, 0, 12, 0, "b")]);
    expect(out.map((o) => [o.lane, o.lanes, o.span])).toEqual([[0, 1, 1], [0, 1, 1]]);
  });

  it("lets an event grow into the lanes to its right that are free while it runs", () => {
    // The Wednesday evening from the report: A 18:30–20:00, B 19:15–20:00,
    // C 19:30–20:30, D 20:00–21:00. D only collides with C (lane 2), so it
    // takes lanes 0 and 1 instead of a third of the column.
    const out = layoutDayEvents([
      ev(18, 30, 20, 0, "a"), ev(19, 15, 20, 0, "b"), ev(19, 30, 20, 30, "c"), ev(20, 0, 21, 0, "d"),
    ], (e) => (e as { id: string }).id);
    const byId = Object.fromEntries(out.map((o) => [(o.event as { id: string }).id, o]));
    expect(byId.a).toMatchObject({ lane: 0, lanes: 3, span: 1 });
    expect(byId.b).toMatchObject({ lane: 1, lanes: 3, span: 1 });
    expect(byId.c).toMatchObject({ lane: 2, lanes: 3, span: 1 });
    expect(byId.d).toMatchObject({ lane: 0, lanes: 3, span: 2 });
  });

  it("never grows across a lane another event holds, even if a lane beyond it is free", () => {
    // A 9–12 in lane 0, B 9–10 in lane 1, C 9–10:30 in lane 2. After B ends,
    // lane 1 is free but A cannot jump over C's lane 2 — and it starts at
    // lane 0, so its span stays 1 while B runs; the grid does not re-flow.
    const out = layoutDayEvents([ev(9, 0, 12, 0, "a"), ev(9, 0, 10, 0, "b"), ev(9, 0, 10, 30, "c")], (e) => (e as { id: string }).id);
    const byId = Object.fromEntries(out.map((o) => [(o.event as { id: string }).id, o]));
    expect(byId.a.span).toBe(1);
    expect(byId.b.span).toBe(1);
    expect(byId.c.span).toBe(1);
    // Point events keep their sliver semantics: simultaneous starts overlap.
    const points = layoutDayEvents([ev(16, 0, 16, 0, "p1"), ev(16, 0, 16, 0, "p2")]);
    expect(points.map((o) => o.span)).toEqual([1, 1]);
  });

  it("is deterministic via the key tiebreaker", () => {
    const a = layoutDayEvents([ev(9, 0, 11, 0, "b"), ev(9, 0, 11, 0, "a")], (e) => (e as { id: string }).id);
    expect(a.map((o) => (o.event as { id: string }).id)).toEqual(["a", "b"]);
  });
});

describe("block height (finding 2026-09-04: the minimum height overpainted a touching successor)", () => {
  const px = 44; // the default hour height: 15 min = 11 px, below the 16 px minimum

  it("keeps the true height when the next block in the lane starts where this one ends", () => {
    const out = blockHeightPx({ startMin: 645, endMin: 660, nextStartMin: 660, pxPerHour: px, minPx: 16 });
    expect(out.height).toBeCloseTo(11, 5);
    expect(out.compact).toBe(true);
  });

  it("pads a short block to the minimum when there is room below it", () => {
    expect(blockHeightPx({ startMin: 645, endMin: 660, nextStartMin: null, pxPerHour: px, minPx: 16 })).toEqual({ height: 16, compact: false });
    // Enough room: 15 min block, next one 30 min later.
    expect(blockHeightPx({ startMin: 645, endMin: 660, nextStartMin: 690, pxPerHour: px, minPx: 16 })).toEqual({ height: 16, compact: false });
  });

  it("pads only as far as the room allows", () => {
    // 5-minute block (≈3.7 px), the next one 10 minutes later (≈7.3 px of room).
    const out = blockHeightPx({ startMin: 600, endMin: 605, nextStartMin: 610, pxPerHour: px, minPx: 16 });
    expect(out.height).toBeCloseTo(minutesToPx(10, px), 5);
    expect(out.compact).toBe(true);
  });

  it("leaves a long block alone", () => {
    expect(blockHeightPx({ startMin: 600, endMin: 660, nextStartMin: 660, pxPerHour: px, minPx: 16 })).toEqual({ height: 44, compact: false });
  });

  it("finds the next block in the same lane only — across clusters, never across lanes", () => {
    const blocks = [
      { lane: 0, startMin: 645, endMin: 660 }, // IT JF
      { lane: 0, startMin: 660, endMin: 675 }, // JF Gesamtteam (next cluster, same lane index)
      { lane: 1, startMin: 665, endMin: 700 }, // a neighbour in another lane
      { lane: 0, startMin: 675, endMin: 720 }, // MK/KR
    ];
    expect(nextLaneStartMin(blocks, 0)).toBe(660);
    expect(nextLaneStartMin(blocks, 1)).toBe(675);
    expect(nextLaneStartMin(blocks, 2)).toBeNull();
    expect(nextLaneStartMin(blocks, 3)).toBeNull();
  });
});

describe("time math", () => {
  it("minutesInDay clamps to the day and rounds to whole minutes", () => {
    expect(minutesInDay(at(9, 30), DAY)).toBe(570);
    expect(minutesInDay(DAY - 60000, DAY)).toBe(0);
    expect(minutesInDay(DAY + 25 * 60 * 60000, DAY)).toBe(1440);
  });

  it("snapMinutes rounds to the step and clamps", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(692, 15)).toBe(690);
    expect(snapMinutes(1500)).toBe(1440);
    expect(snapMinutes(-5)).toBe(0);
  });

  it("pxToMinutes and minutesToPx are inverse for a given row height", () => {
    const pxPerHour = 44;
    expect(Math.round(pxToMinutes(minutesToPx(570, pxPerHour), pxPerHour))).toBe(570);
    expect(pxToMinutes(-10, pxPerHour)).toBe(0);
    expect(pxToMinutes(99999, pxPerHour)).toBe(1440);
  });

  it("minutesToHHMM formats zero-padded 24h", () => {
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(570)).toBe("09:30");
    expect(minutesToHHMM(1439)).toBe("23:59");
  });

  it("startOfDayMs returns local midnight", () => {
    expect(startOfDayMs(at(15, 45))).toBe(DAY);
  });
});

describe("buildContiguousDays", () => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  it("returns a single day for count 1", () => {
    expect(buildContiguousDays(new Date(2026, 6, 9), 1).map(iso)).toEqual(["2026-07-09"]);
  });
  it("returns three consecutive days for count 3, crossing a month end", () => {
    expect(buildContiguousDays(new Date(2026, 6, 30), 3).map(iso)).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });
  it("never returns fewer than one day", () => {
    expect(buildContiguousDays(new Date(2026, 6, 9), 0)).toHaveLength(1);
  });
});

describe("moveEventMinutes (drag to reschedule, duration preserved)", () => {
  it("places the start under the pointer minus the grab offset, snapped", () => {
    // grabbed 10 min into a 60-min block; pointer at 09:37 → start snaps to 09:30
    const r = moveEventMinutes({ pointerMin: 9 * 60 + 37, grabOffsetMin: 10, durationMin: 60 });
    expect(r).toEqual({ startMin: 9 * 60 + 30, endMin: 10 * 60 + 30 });
  });
  it("keeps the whole block inside the day (clamps at both ends)", () => {
    expect(moveEventMinutes({ pointerMin: 0, grabOffsetMin: 30, durationMin: 60 }).startMin).toBe(0);
    const late = moveEventMinutes({ pointerMin: 24 * 60, grabOffsetMin: 0, durationMin: 90 });
    expect(late).toEqual({ startMin: 24 * 60 - 90, endMin: 24 * 60 });
  });
  it("preserves the duration regardless of pointer position", () => {
    const r = moveEventMinutes({ pointerMin: 13 * 60, grabOffsetMin: 0, durationMin: 45 });
    expect(r.endMin - r.startMin).toBe(45);
  });
});

describe("resizeEventEndMinutes (drag the bottom edge)", () => {
  it("snaps the new end to the pointer", () => {
    expect(resizeEventEndMinutes({ pointerMin: 11 * 60 + 3, startMin: 10 * 60 })).toBe(11 * 60);
    expect(resizeEventEndMinutes({ pointerMin: 11 * 60 + 8, startMin: 10 * 60 })).toBe(11 * 60 + 15);
  });
  it("never shrinks below one snap step above the start", () => {
    expect(resizeEventEndMinutes({ pointerMin: 9 * 60, startMin: 10 * 60 })).toBe(10 * 60 + 15);
  });
  it("clamps the end to the day", () => {
    expect(resizeEventEndMinutes({ pointerMin: 25 * 60, startMin: 23 * 60 })).toBe(24 * 60);
  });
});

// type-only sanity: the exported interface is usable
const _typecheck: TimeGridEvent = { startMs: 0, endMs: 1 };
void _typecheck;
