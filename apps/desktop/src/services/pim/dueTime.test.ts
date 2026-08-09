import { describe, expect, it } from "vitest";
import { parseDueValue } from "@plainva/ui";

describe("parseDueValue", () => {
  it("keeps the time a datetime column carries", () => {
    expect(parseDueValue("2026-08-09T12:00")).toEqual({ day: "2026-08-09", minutes: 720 });
    expect(parseDueValue("2026-08-09T14:30:00")).toEqual({ day: "2026-08-09", minutes: 870 });
    // A space instead of the T — what a person types by hand.
    expect(parseDueValue("2026-08-09 09:15")).toEqual({ day: "2026-08-09", minutes: 555 });
  });

  it("leaves a bare date day-granular", () => {
    expect(parseDueValue("2026-08-09")).toEqual({ day: "2026-08-09" });
  });

  it("treats a stamped midnight as a bare date", () => {
    // Tools write "…T00:00" for a date. Read as a position it would hang every
    // such task at the very top of the grid, claiming a precision the note
    // never had.
    expect(parseDueValue("2026-08-09T00:00")).toEqual({ day: "2026-08-09" });
  });

  it("keeps the date but drops a broken clock", () => {
    expect(parseDueValue("2026-08-09T25:00")).toEqual({ day: "2026-08-09" });
    expect(parseDueValue("2026-08-09T12:73")).toEqual({ day: "2026-08-09" });
  });

  it("rejects what is not a date at all", () => {
    // An unparseable value is not a task due at midnight.
    for (const raw of [null, undefined, "", "soon", "09.08.2026", 42]) {
      expect(parseDueValue(raw)).toBeNull();
    }
  });

  it("ignores a zone suffix rather than shifting the day", () => {
    // The value is civil time: what stands in the note is what the reader
    // means. Converting it could move a 00:30 task onto the day before.
    expect(parseDueValue("2026-08-09T23:30Z")).toEqual({ day: "2026-08-09", minutes: 1410 });
    expect(parseDueValue("2026-08-09T23:30+02:00")).toEqual({ day: "2026-08-09", minutes: 1410 });
  });
});
