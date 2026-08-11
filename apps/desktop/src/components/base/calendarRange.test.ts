import { describe, it, expect } from "vitest";
import {
  addDays,
  compareByTime,
  dayPartOf,
  entryDayKeys,
  layoutSpanningEvents,
  minutesOf,
  rangeRows,
  startOfWeekKey,
  stepCursor,
  timeLabel,
  type CalendarCursor,
} from "@plainva/ui";

/**
 * The three periods of a `.base` calendar (S20). Every assertion here decides
 * what a user sees on a given day, so each has a red counter-proof noted in the
 * loop's § 5.
 */

describe("rangeRows", () => {
  it("gives a month six rows of seven, with the neighbouring days empty", () => {
    // August 2026 starts on a Saturday: five leading blanks in a Monday week.
    const rows = rangeRows({ range: "month", day: "2026-08-12" });
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows[0]!.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(rows[0]![5]).toBe("2026-08-01");
    expect(rows.flat().filter(Boolean)).toHaveLength(31);
  });

  it("gives a week one row of seven, containing the anchor day", () => {
    const rows = rangeRows({ range: "week", day: "2026-08-12" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("gives a day exactly its own day", () => {
    expect(rangeRows({ range: "day", day: "2026-08-12" })).toEqual([["2026-08-12"]]);
  });

  it("honours a Sunday week start in BOTH the week and the month", () => {
    // The real calendar has this setting; a database calendar that ignored it
    // would show the user a different week than every other surface.
    expect(startOfWeekKey("2026-08-12", 0)).toBe("2026-08-09");
    expect(rangeRows({ range: "week", day: "2026-08-12" }, 0)[0]![0]).toBe("2026-08-09");
    // August 1st 2026 is a Saturday — six blanks in a Sunday week, five in a
    // Monday one.
    expect(rangeRows({ range: "month", day: "2026-08-12" }, 0)[0]!.filter((d) => d === null)).toHaveLength(6);
  });
});

describe("stepCursor", () => {
  it("moves by the period it is showing", () => {
    expect(stepCursor({ range: "day", day: "2026-08-12" }, 1).day).toBe("2026-08-13");
    expect(stepCursor({ range: "week", day: "2026-08-12" }, 1).day).toBe("2026-08-19");
    expect(stepCursor({ range: "month", day: "2026-08-12" }, 1).day).toBe("2026-09-12");
    expect(stepCursor({ range: "month", day: "2026-08-12" }, -1).day).toBe("2026-07-12");
  });

  it("does not skip a month when stepping from the 31st", () => {
    // Naive month arithmetic turns 31 January + 1 into 3 March.
    expect(stepCursor({ range: "month", day: "2026-01-31" }, 1).day).toBe("2026-02-28");
    expect(stepCursor({ range: "month", day: "2026-03-31" }, -1).day).toBe("2026-02-28");
  });

  it("keeps the period while moving the day", () => {
    const c: CalendarCursor = { range: "week", day: "2026-08-12" };
    expect(stepCursor(c, 1).range).toBe("week");
  });
});

describe("reading a date cell", () => {
  it("takes the day from a plain date and from one with a time", () => {
    expect(dayPartOf("2026-08-12")).toBe("2026-08-12");
    expect(dayPartOf("2026-08-12T14:30")).toBe("2026-08-12");
    expect(dayPartOf("noch offen")).toBe("");
    expect(dayPartOf(undefined)).toBe("");
  });

  it("reads a time only when there is one", () => {
    expect(minutesOf("2026-08-12T14:30")).toBe(14 * 60 + 30);
    expect(timeLabel("2026-08-12T09:05")).toBe("09:05");
    // An entry that says "the 12th" must not be treated as midnight.
    expect(minutesOf("2026-08-12")).toBeUndefined();
    expect(timeLabel("2026-08-12")).toBe("");
  });

  it("sorts timed entries by the clock and puts untimed ones after them", () => {
    const day = ["2026-08-12", "2026-08-12T14:30", "2026-08-12T09:00"];
    expect([...day].sort(compareByTime)).toEqual(["2026-08-12T09:00", "2026-08-12T14:30", "2026-08-12"]);
  });
});

describe("entryDayKeys", () => {
  it("is one day without an end column", () => {
    expect(entryDayKeys("2026-08-12")).toEqual(["2026-08-12"]);
  });

  it("covers every day from start to end, inclusive", () => {
    expect(entryDayKeys("2026-08-12", "2026-08-14")).toEqual(["2026-08-12", "2026-08-13", "2026-08-14"]);
  });

  it("is one day when the end lies before the start or is missing", () => {
    // A span needs two ends; inventing the second would turn every ordinary
    // entry into a bar.
    expect(entryDayKeys("2026-08-12", "2026-08-10")).toEqual(["2026-08-12"]);
    expect(entryDayKeys("2026-08-12", "")).toEqual(["2026-08-12"]);
  });

  it("does not build a giant array from a mistyped year", () => {
    expect(entryDayKeys("2026-08-12", "9999-08-12").length).toBeLessThanOrEqual(400);
  });

  it("is empty when the start cannot be read", () => {
    expect(entryDayKeys("bald", "2026-08-14")).toEqual([]);
  });
});

describe("spans over the shared layout (same helper as the real calendar, S5)", () => {
  const week = rangeRows({ range: "week", day: "2026-08-12" })[0]!.filter((d): d is string => !!d);
  const rows = [
    { name: "Sprint", start: "2026-08-11", end: "2026-08-14" },
    { name: "Meilenstein", start: "2026-08-12" },
  ];

  it("draws a multi-day entry as ONE bar over its columns", () => {
    const out = layoutSpanningEvents(week, rows, { keysOf: (r) => entryDayKeys(r.start, r.end) });
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0]!.event.name).toBe("Sprint");
    expect(out.bars[0]!.startCol).toBe(1);
    expect(out.bars[0]!.endCol).toBe(4);
    // The single-day entry stays a chip — it is not a span.
    expect(out.spanned.has(rows[1]!)).toBe(false);
    expect(out.spanned.has(rows[0]!)).toBe(true);
  });

  it("clips a bar that leaves the week instead of repeating it", () => {
    const long = [{ name: "Urlaub", start: "2026-08-05", end: "2026-08-20" }];
    const out = layoutSpanningEvents(week, long, { keysOf: (r) => entryDayKeys(r.start, r.end) });
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0]!.clippedStart).toBe(true);
    expect(out.bars[0]!.clippedEnd).toBe(true);
    expect(out.bars[0]!.startCol).toBe(0);
    expect(out.bars[0]!.endCol).toBe(6);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
