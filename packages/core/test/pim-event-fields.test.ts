import { describe, expect, it } from "vitest";
import { sortedMinutes } from "../src/pim/eventFields.ts";

describe("sortedMinutes", () => {
  it("sorts ascending and collapses duplicates", () => {
    // A popup and an email reminder at the same moment are ONE moment for the
    // person reading the calendar.
    expect(sortedMinutes([30, 10, 30, 0])).toEqual([0, 10, 30]);
  });

  it("drops what does not describe a moment before the start", () => {
    expect(sortedMinutes([undefined, null, Number.NaN, -5, 15])).toEqual([15]);
  });

  it("returns an empty list rather than nothing", () => {
    // The distinction matters upstream: `[]` means "no reminder", `undefined`
    // means "the event said nothing at all".
    expect(sortedMinutes([])).toEqual([]);
  });
});
