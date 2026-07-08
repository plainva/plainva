import { describe, expect, it } from "vitest";
import { buildMonthCells, isoWeeksForCells } from "./calendarGrid";

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
