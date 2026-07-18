import { describe, expect, it } from "vitest";
import { recurrenceToRRule, parseRRule } from "../src/pim/recurrence.ts";

describe("recurrence <-> RRULE", () => {
  it("serializes frequency, interval, weekly days and end conditions", () => {
    expect(recurrenceToRRule({ freq: "daily" })).toBe("FREQ=DAILY");
    expect(recurrenceToRRule({ freq: "weekly", interval: 2 })).toBe("FREQ=WEEKLY;INTERVAL=2");
    expect(recurrenceToRRule({ freq: "weekly", byWeekday: ["MO", "WE"] })).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(recurrenceToRRule({ freq: "monthly", count: 5 })).toBe("FREQ=MONTHLY;COUNT=5");
    expect(recurrenceToRRule({ freq: "yearly", until: "2026-12-31" })).toBe("FREQ=YEARLY;UNTIL=20261231T235959Z");
    // COUNT wins over UNTIL when both slip in.
    expect(recurrenceToRRule({ freq: "daily", count: 3, until: "2026-12-31" })).toBe("FREQ=DAILY;COUNT=3");
    // interval 1 is the default and is omitted.
    expect(recurrenceToRRule({ freq: "daily", interval: 1 })).toBe("FREQ=DAILY");
  });

  it("parses an RRULE back into the structured shape", () => {
    expect(parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toEqual({ freq: "weekly", interval: 2, byWeekday: ["MO", "WE"] });
    expect(parseRRule("FREQ=MONTHLY;COUNT=5")).toEqual({ freq: "monthly", count: 5 });
    expect(parseRRule("FREQ=YEARLY;UNTIL=20261231T235959Z")).toEqual({ freq: "yearly", until: "2026-12-31" });
    expect(parseRRule("FREQ=DAILY")).toEqual({ freq: "daily" });
  });

  it("returns null for missing / unusable input", () => {
    expect(parseRRule(undefined)).toBeNull();
    expect(parseRRule("")).toBeNull();
    expect(parseRRule("RRULE")).toBeNull();
    expect(parseRRule("INTERVAL=2")).toBeNull(); // no FREQ
  });

  it("round-trips", () => {
    for (const r of [
      { freq: "weekly" as const, interval: 3, byWeekday: ["TU", "TH"], count: 8 },
      { freq: "monthly" as const, until: "2027-01-15" },
    ]) {
      const back = parseRRule(recurrenceToRRule(r));
      expect(back?.freq).toBe(r.freq);
    }
  });
});
