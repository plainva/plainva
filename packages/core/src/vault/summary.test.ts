import { describe, it, expect } from "vitest";
import { computeSummary, isSummaryName, SUMMARY_NAMES } from "./summary.js";

describe("summary names", () => {
  // Quoted from Obsidian's Bases syntax docs (verified 2026-08-11), not
  // invented: both apps must agree on what "Average" means.
  it("is exactly Obsidian's default vocabulary", () => {
    expect([...SUMMARY_NAMES]).toEqual([
      "Average", "Min", "Max", "Sum", "Range", "Median", "Stddev",
      "Earliest", "Latest", "Checked", "Unchecked", "Empty", "Filled", "Unique",
    ]);
  });

  it("rejects a custom formula name — Plainva shows nothing rather than guessing", () => {
    expect(isSummaryName("customAverage")).toBe(false);
    expect(isSummaryName("average")).toBe(false); // case matters
    expect(isSummaryName("Average")).toBe(true);
  });
});

describe("computeSummary", () => {
  it("measures numbers", () => {
    const v = [10, "20", 30, undefined, ""];
    expect(computeSummary("Sum", v)).toBe(60);
    expect(computeSummary("Average", v)).toBe(20);
    expect(computeSummary("Min", v)).toBe(10);
    expect(computeSummary("Max", v)).toBe(30);
    expect(computeSummary("Range", v)).toBe(20);
    expect(computeSummary("Median", v)).toBe(20);
    expect(computeSummary("Stddev", [2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("counts notes, not values", () => {
    const v = ["x", "", undefined, [], ["a"]];
    expect(computeSummary("Filled", v)).toBe(2);
    expect(computeSummary("Empty", v)).toBe(3);
    expect(computeSummary("Unique", [["a", "b"], ["b"], "c", undefined])).toBe(3);
  });

  it("counts checkboxes in both spellings", () => {
    expect(computeSummary("Checked", [true, "true", false, undefined])).toBe(2);
    expect(computeSummary("Unchecked", [true, "true", false, undefined])).toBe(2);
  });

  it("finds the first and last date, and reads Range as a span in days", () => {
    const v = ["2026-08-11", "2026-08-01", "kein Datum", undefined];
    expect(computeSummary("Earliest", v)).toBe("2026-08-01");
    expect(computeSummary("Latest", v)).toBe("2026-08-11");
    expect(computeSummary("Range", v)).toBe(10);
  });

  // A footer of nothing is not zero: it would read as a measurement.
  it("returns nothing when there is nothing to measure", () => {
    expect(computeSummary("Sum", [])).toBeNull();
    expect(computeSummary("Sum", ["Offen", undefined])).toBeNull();
    expect(computeSummary("Latest", ["morgen"])).toBeNull();
    expect(computeSummary("Range", [])).toBeNull();
    // Counting functions legitimately answer 0.
    expect(computeSummary("Filled", [])).toBe(0);
  });
});
