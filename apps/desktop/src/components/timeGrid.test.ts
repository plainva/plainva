import { describe, expect, it } from "vitest";
import {
  layoutDayEvents,
  minutesInDay,
  snapMinutes,
  pxToMinutes,
  minutesToPx,
  minutesToHHMM,
  startOfDayMs,
  buildContiguousDays,
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

  it("is deterministic via the key tiebreaker", () => {
    const a = layoutDayEvents([ev(9, 0, 11, 0, "b"), ev(9, 0, 11, 0, "a")], (e) => (e as { id: string }).id);
    expect(a.map((o) => (o.event as { id: string }).id)).toEqual(["a", "b"]);
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

// type-only sanity: the exported interface is usable
const _typecheck: TimeGridEvent = { startMs: 0, endMs: 1 };
void _typecheck;
