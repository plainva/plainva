import { afterEach, describe, expect, it } from "vitest";
import {
  boundaryLabel,
  calendarDay,
  clampBoundary,
  DAY_END_CHOICES,
  dayBoundary,
  journalDate,
  journalDay,
  journalToday,
  onDayBoundaryChange,
  setDayBoundary,
} from "@plainva/ui";

/**
 * One "today" for the whole app (plan Journal-Erweiterungen, X1/E1).
 *
 * The calendar's day and the diary's day are two questions. Someone writing at
 * 01:30 is still finishing yesterday; an appointment at 01:30 is not. These
 * pin that difference, the edges of the boundary, and the two turns of the
 * clock a naive "minus six hours" gets wrong.
 */
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe("calendarDay", () => {
  it("is the local day, never the UTC one", () => {
    expect(calendarDay(at(2026, 9, 22, 0, 1))).toBe("2026-09-22");
    expect(calendarDay(at(2026, 9, 22, 23, 59))).toBe("2026-09-22");
    // A key is padded, so string order is date order — every list relies on it.
    expect(calendarDay(at(2026, 1, 5, 12))).toBe("2026-01-05");
  });
});

describe("journalDay", () => {
  it("is the calendar day when no boundary is set", () => {
    for (const hour of [0, 3, 12, 23]) {
      expect(journalDay(at(2026, 9, 22, hour), 0)).toBe(calendarDay(at(2026, 9, 22, hour)));
    }
  });

  it("puts the small hours on the day before, and keeps the rest where it is", () => {
    const four = 4 * 60;
    expect(journalDay(at(2026, 9, 22, 1, 30), four)).toBe("2026-09-21");
    expect(journalDay(at(2026, 9, 22, 3, 59), four)).toBe("2026-09-21");
    // The boundary itself already belongs to the new day.
    expect(journalDay(at(2026, 9, 22, 4, 0), four)).toBe("2026-09-22");
    expect(journalDay(at(2026, 9, 22, 4, 1), four)).toBe("2026-09-22");
    expect(journalDay(at(2026, 9, 22, 23, 59), four)).toBe("2026-09-22");
  });

  it("steps back over a month and over a year", () => {
    expect(journalDay(at(2026, 10, 1, 2), 4 * 60)).toBe("2026-09-30");
    expect(journalDay(at(2026, 1, 1, 2), 4 * 60)).toBe("2025-12-31");
    // A leap day is a day like any other.
    expect(journalDay(at(2028, 3, 1, 2), 4 * 60)).toBe("2028-02-29");
  });

  it("survives both turns of the clock", () => {
    // The shift asks the CALENDAR for "the day before" instead of subtracting
    // hours: on the short night that would land two days back, on the long one
    // it would not move at all.
    expect(journalDay(at(2026, 3, 29, 3, 30), 4 * 60)).toBe("2026-03-28");
    expect(journalDay(at(2026, 10, 25, 2, 30), 4 * 60)).toBe("2026-10-24");
  });

  it("refuses a boundary outside the day's small hours", () => {
    expect(clampBoundary(-5)).toBe(0);
    expect(clampBoundary(999)).toBe(360);
    expect(clampBoundary(Number.NaN)).toBe(0);
    expect(clampBoundary("04:00" as unknown)).toBe(0);
    // A stored value that drifted out of range must not move the diary a week.
    expect(journalDay(at(2026, 9, 22, 7), 999)).toBe("2026-09-22");
  });
});

describe("boundaryLabel", () => {
  it("reads as a clock", () => {
    expect(boundaryLabel(0)).toBe("00:00");
    expect(boundaryLabel(4 * 60)).toBe("04:00");
    expect(boundaryLabel(150)).toBe("02:30");
  });

  it("offers midnight and every half hour to six", () => {
    expect(DAY_END_CHOICES[0]).toBe(0);
    expect(DAY_END_CHOICES.at(-1)).toBe(360);
    expect(DAY_END_CHOICES).toHaveLength(13);
    expect(DAY_END_CHOICES.every((m) => m === clampBoundary(m))).toBe(true);
  });
});

describe("the vault's boundary (X2)", () => {
  afterEach(() => setDayBoundary(0));

  it("is midnight until a shell says otherwise", () => {
    expect(dayBoundary()).toBe(0);
    expect(journalToday(at(2026, 9, 22, 1, 30))).toEqual(journalDate(at(2026, 9, 22, 1, 30), 0));
  });

  it("moves what `journalToday` answers, for every way into the journal at once", () => {
    setDayBoundary(4 * 60);
    expect(calendarDay(journalToday(at(2026, 9, 22, 1, 30)))).toBe("2026-09-21");
    expect(calendarDay(journalToday(at(2026, 9, 22, 9, 0)))).toBe("2026-09-22");
  });

  it("tells the views, so a sentence about it does not wait for midnight", () => {
    const seen: number[] = [];
    const stop = onDayBoundaryChange((minutes) => seen.push(minutes));
    setDayBoundary(240);
    setDayBoundary(240); // the same value is not a change
    setDayBoundary(0);
    stop();
    setDayBoundary(300); // after unsubscribing, nothing more arrives
    expect(seen).toEqual([240, 0]);
  });

  it("takes only a value the setting can produce", () => {
    setDayBoundary(10_000);
    expect(dayBoundary()).toBe(360);
    setDayBoundary("04:00");
    expect(dayBoundary()).toBe(0);
  });
});
