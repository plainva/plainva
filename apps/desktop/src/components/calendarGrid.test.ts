import { describe, expect, it } from "vitest";
import { buildMonthCells, buildWeekCells, startOfWeek, isoWeeksForCells } from "@plainva/ui";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("buildMonthCells", () => {
  it("builds a 42-cell grid starting on the Monday on/before the 1st", () => {
    const cells = buildMonthCells(new Date(2026, 6, 1)); // July 2026 (1st = Wednesday)
    expect(cells).toHaveLength(42);
    expect(iso(cells[0])).toBe("2026-06-29"); // Monday before
    expect(iso(cells[41])).toBe("2026-08-09");
    // Every row starts on a Monday.
    for (let r = 0; r < 42; r += 7) expect(cells[r].getDay()).toBe(1);
  });

  it("starts on the 1st itself when the month begins on a Monday", () => {
    const cells = buildMonthCells(new Date(2026, 5, 1)); // June 2026 (1st = Monday)
    expect(iso(cells[0])).toBe("2026-06-01");
  });
});

describe("isoWeeksForCells", () => {
  it("returns the six ISO week numbers of a plain mid-year month", () => {
    expect(isoWeeksForCells(buildMonthCells(new Date(2026, 6, 1)))).toEqual([27, 28, 29, 30, 31, 32]);
  });

  it("labels late December as week 1 of the next ISO year (January 2026 grid)", () => {
    // 2026-01-01 is a Thursday, so the week containing 2025-12-29 is already week 1.
    expect(isoWeeksForCells(buildMonthCells(new Date(2026, 0, 1)))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("handles a 53-week ISO year (December 2026 grid)", () => {
    expect(isoWeeksForCells(buildMonthCells(new Date(2026, 11, 1)))).toEqual([49, 50, 51, 52, 53, 1]);
  });

  it("labels an early-January row with the previous ISO year's last week (January 2027 grid)", () => {
    // 2027-01-01 is a Friday: the row of Dec 28 2026 - Jan 3 2027 is week 53 of 2026.
    expect(isoWeeksForCells(buildMonthCells(new Date(2027, 0, 1)))).toEqual([53, 1, 2, 3, 4, 5]);
  });
});

describe("week start variants", () => {
  it("buildMonthCells with a Sunday start begins the grid on the Sunday on/before the 1st", () => {
    // 2026-07-01 is a Wednesday; the Sunday before is 2026-06-28.
    const cells = buildMonthCells(new Date(2026, 6, 1), 0);
    expect(iso(cells[0])).toBe("2026-06-28");
    expect(cells[0].getDay()).toBe(0);
    expect(cells).toHaveLength(42);
  });

  it("buildMonthCells with a Saturday start begins on the Saturday on/before the 1st", () => {
    const cells = buildMonthCells(new Date(2026, 6, 1), 6);
    expect(iso(cells[0])).toBe("2026-06-27");
    expect(cells[0].getDay()).toBe(6);
  });

  it("startOfWeek honors the week-start day (Monday default, Sunday variant)", () => {
    // 2026-07-15 is a Wednesday.
    expect(iso(startOfWeek(new Date(2026, 6, 15)))).toBe("2026-07-13"); // Monday
    expect(iso(startOfWeek(new Date(2026, 6, 15), 0))).toBe("2026-07-12"); // Sunday
    // A date ON the week-start day maps to itself.
    expect(iso(startOfWeek(new Date(2026, 6, 13)))).toBe("2026-07-13");
  });

  it("buildWeekCells yields the 7 consecutive days of the containing week", () => {
    const wk = buildWeekCells(new Date(2026, 6, 15), 1);
    expect(wk).toHaveLength(7);
    expect(iso(wk[0])).toBe("2026-07-13");
    expect(iso(wk[6])).toBe("2026-07-19");
  });
});
