import { describe, it, expect } from "vitest";
import { actualTimeOf, formatMinutesAsHours, type TimedEntry } from "@plainva/ui";

const entries = (rows: [string, string, string][]) =>
  new Map<string, TimedEntry>(rows.map(([uid, start, end]) => [uid, { uid, start, end }]));

describe("actualTimeOf", () => {
  it("sums the durations of the blocked entries", () => {
    const cache = entries([
      ["e1", "2026-08-11T09:00:00Z", "2026-08-11T10:30:00Z"],
      ["e2", "2026-08-12T14:00:00Z", "2026-08-12T15:00:00Z"],
    ]);
    expect(actualTimeOf([{ uid: "e1" }, { uid: "e2" }], cache)).toEqual({ minutes: 150, missing: 0 });
  });

  // Decision E5: not measured is a dash, never a zero. A zero beside a planned
  // effort claims the task was worked on for no time at all.
  it("returns nothing when there is no calendar to look in", () => {
    expect(actualTimeOf([], entries([]))).toBeNull();
    expect(actualTimeOf([{ uid: "e1" }], entries([]))).toBeNull();
  });

  it("says how many anchors it could not resolve instead of hiding the gap", () => {
    const cache = entries([["e1", "2026-08-11T09:00:00Z", "2026-08-11T10:00:00Z"]]);
    expect(actualTimeOf([{ uid: "e1" }, { uid: "weg" }], cache)).toEqual({ minutes: 60, missing: 1 });
  });

  it("counts an entry once even when two anchors point at it", () => {
    const cache = entries([["e1", "2026-08-11T09:00:00Z", "2026-08-11T10:00:00Z"]]);
    expect(actualTimeOf([{ uid: "e1" }, { uid: "e1" }], cache)).toEqual({ minutes: 60, missing: 0 });
  });

  it("treats a broken or backwards entry as unresolved, not as negative time", () => {
    const cache = entries([
      ["ok", "2026-08-11T09:00:00Z", "2026-08-11T10:00:00Z"],
      ["rueckwaerts", "2026-08-11T10:00:00Z", "2026-08-11T09:00:00Z"],
      ["kaputt", "morgen", "übermorgen"],
    ]);
    expect(actualTimeOf([{ uid: "ok" }, { uid: "rueckwaerts" }, { uid: "kaputt" }], cache))
      .toEqual({ minutes: 60, missing: 2 });
  });
});

describe("formatMinutesAsHours", () => {
  it("reads as hours while the file keeps minutes", () => {
    expect(formatMinutesAsHours(105)).toBe("1:45");
    expect(formatMinutesAsHours(60)).toBe("1:00");
    expect(formatMinutesAsHours(0)).toBe("0:00");
    expect(formatMinutesAsHours(-90)).toBe("-1:30");
  });
});
