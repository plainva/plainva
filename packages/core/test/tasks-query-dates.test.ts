import { afterEach, describe, expect, it } from "vitest";
import { tasksDayNumber } from "../src/vault/taskMetadata.js";
import { addDays, addMonths, addYears, dayNumberOf, isoWeekday, isoWeekMonday, isoWeekOf, isoWeeksInYear, parseTasksDate, type TasksDateParse } from "../src/tasksQuery/index.js";

/** Date arithmetic of Tasks queries (plan Tasks-Abfragen, T2): day keys only, ISO weeks, no clock. */

const range = (from: string, to: string): TasksDateParse => ({ ok: true, value: { kind: "range", from, to } });
const day = (key: string): TasksDateParse => ({ ok: true, value: { kind: "day", day: key } });

describe("calendar arithmetic", () => {
  it("month ends and leap years", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("day numbers by arithmetic agree with the calendar for every day of four centuries' edges", () => {
    for (const start of ["1899-12-01", "1969-12-01", "1999-12-01", "2026-01-01", "2099-12-01", "2399-12-01"]) {
      let stamp = Date.parse(start + "T00:00:00Z");
      for (let i = 0; i < 500; i++, stamp += 86_400_000) {
        const key = new Date(stamp).toISOString().slice(0, 10);
        expect(dayNumberOf(key)).toBe(tasksDayNumber(key));
      }
    }
    for (const invalid of ["2026-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", "20261001xx", "2026-10-1x"]) expect(dayNumberOf(invalid)).toBeNull();
    expect(dayNumberOf("2000-02-29")).not.toBeNull();
  });

  it("weekdays and ISO weeks, week 53 included", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(isoWeekday("1969-12-31")).toBe(3);
    expect(isoWeekOf("2026-01-01")).toEqual({ year: 2026, week: 1 });
    expect(isoWeekOf("2026-12-31")).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOf("2027-01-03")).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOf("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeekOf("2021-01-03")).toEqual({ year: 2020, week: 53 });
    expect(isoWeekOf("2024-12-30")).toEqual({ year: 2025, week: 1 });
    expect([2015, 2020, 2021, 2026, 2027, 2032].map(isoWeeksInYear)).toEqual([53, 53, 52, 53, 52, 53]);
    expect(isoWeekMonday(2026, 1)).toBe("2025-12-29");
    expect(isoWeekMonday(2026, 53)).toBe("2026-12-28");
    expect(isoWeekMonday(2027, 53)).toBeNull();
    expect(isoWeekMonday(2026, 0)).toBeNull();
  });
});

describe("date phrases", () => {
  const today = "2026-10-29"; // Thursday, ISO week 44

  it("absolute days and ranges of two days", () => {
    expect(parseTasksDate("2026-10-25", today)).toEqual(day("2026-10-25"));
    expect(parseTasksDate("2026-11-30 2026-11-01", today)).toEqual(range("2026-11-01", "2026-11-30"));
    // One of the two invalid: the other alone, as in Tasks.
    expect(parseTasksDate("2026-02-30 2026-03-01", today)).toEqual(day("2026-03-01"));
    expect(parseTasksDate("2026-02-30 2026-02-31", today)).toEqual({ ok: false, reason: "invalid" });
  });

  it("numbered weeks, months, quarters and years", () => {
    expect(parseTasksDate("2026-W44", today)).toEqual(range("2026-10-26", "2026-11-01"));
    expect(parseTasksDate("2026-w53", today)).toEqual(range("2026-12-28", "2027-01-03"));
    expect(parseTasksDate("2026-W01", today)).toEqual(range("2025-12-29", "2026-01-04"));
    expect(parseTasksDate("2028-02", today)).toEqual(range("2028-02-01", "2028-02-29"));
    expect(parseTasksDate("2026-02", today)).toEqual(range("2026-02-01", "2026-02-28"));
    expect(parseTasksDate("2026-12", today)).toEqual(range("2026-12-01", "2026-12-31"));
    expect(parseTasksDate("2026-Q1", today)).toEqual(range("2026-01-01", "2026-03-31"));
    expect(parseTasksDate("2026-q4", today)).toEqual(range("2026-10-01", "2026-12-31"));
    expect(parseTasksDate("2026", today)).toEqual(range("2026-01-01", "2026-12-31"));
    for (const invalid of ["2026-02-29", "2026-13", "2026-00", "2027-W53", "2026-W00", "2026-Q0", "2026-Q5"]) {
      expect(parseTasksDate(invalid, today)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("relative days, weekdays, and N units ago or ahead", () => {
    expect(parseTasksDate("today", today)).toEqual(day("2026-10-29"));
    expect(parseTasksDate("Tomorrow", today)).toEqual(day("2026-10-30"));
    expect(parseTasksDate("yesterday", today)).toEqual(day("2026-10-28"));
    expect(parseTasksDate("thursday", today)).toEqual(day("2026-10-29"));
    expect(parseTasksDate("friday", today)).toEqual(day("2026-10-30"));
    expect(parseTasksDate("wed", today)).toEqual(day("2026-11-04"));
    expect(parseTasksDate("14 days ago", today)).toEqual(day("2026-10-15"));
    expect(parseTasksDate("in two weeks", today)).toEqual(day("2026-11-12"));
    expect(parseTasksDate("a month ago", "2026-03-31")).toEqual(day("2026-02-28"));
    expect(parseTasksDate("in 1 year", "2028-02-29")).toEqual(day("2029-02-28"));
    expect(parseTasksDate("in   3   days", today)).toEqual(day("2026-11-01"));
  });

  it("last, this and next week, month, quarter and year — weeks Monday to Sunday", () => {
    expect(parseTasksDate("this week", today)).toEqual(range("2026-10-26", "2026-11-01"));
    expect(parseTasksDate("last week", today)).toEqual(range("2026-10-19", "2026-10-25"));
    expect(parseTasksDate("next week", today)).toEqual(range("2026-11-02", "2026-11-08"));
    expect(parseTasksDate("this month", today)).toEqual(range("2026-10-01", "2026-10-31"));
    expect(parseTasksDate("last month", today)).toEqual(range("2026-09-01", "2026-09-30"));
    expect(parseTasksDate("next month", today)).toEqual(range("2026-11-01", "2026-11-30"));
    expect(parseTasksDate("this quarter", today)).toEqual(range("2026-10-01", "2026-12-31"));
    expect(parseTasksDate("last quarter", today)).toEqual(range("2026-07-01", "2026-09-30"));
    expect(parseTasksDate("next quarter", today)).toEqual(range("2027-01-01", "2027-03-31"));
    expect(parseTasksDate("next year", today)).toEqual(range("2027-01-01", "2027-12-31"));
    // A Sunday belongs to the week that started on Monday.
    expect(parseTasksDate("this week", "2026-11-01")).toEqual(range("2026-10-26", "2026-11-01"));
    // Across a year end.
    expect(parseTasksDate("this week", "2026-12-31")).toEqual(range("2026-12-28", "2027-01-03"));
    expect(parseTasksDate("next week", "2026-12-31")).toEqual(range("2027-01-04", "2027-01-10"));
    expect(parseTasksDate("next month", "2026-12-31")).toEqual(range("2027-01-01", "2027-01-31"));
    expect(parseTasksDate("last quarter", "2027-01-01")).toEqual(range("2026-10-01", "2026-12-31"));
    expect(parseTasksDate("last month", "2028-03-31")).toEqual(range("2028-02-01", "2028-02-29"));
  });

  it("what Plainva does not read is unknown, not invalid", () => {
    for (const phrase of ["next friday", "last monday", "soon", "next friday at noon", "", "3 days", "in a while"]) {
      expect(parseTasksDate(phrase, today)).toEqual({ ok: false, reason: "unknown" });
    }
  });
});

describe("summer time cannot move a day", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("gives the same days in every time zone, on the days the clocks change", () => {
    const phrases = ["today", "tomorrow", "yesterday", "this week", "next week", "last month", "in 1 week", "7 days ago"];
    const results = (zone: string) => {
      process.env.TZ = zone;
      return ["2026-10-25", "2026-03-29", "2026-11-01", "2026-03-08"].flatMap((d) => phrases.map((p) => parseTasksDate(p, d)));
    };
    const utc = results("UTC");
    for (const zone of ["Europe/Berlin", "America/New_York", "Pacific/Chatham", "Australia/Lord_Howe"]) expect(results(zone)).toEqual(utc);
    expect(parseTasksDate("tomorrow", "2026-10-25")).toEqual(day("2026-10-26"));
    expect(parseTasksDate("this week", "2026-03-29")).toEqual(range("2026-03-23", "2026-03-29"));
  });
});
