import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_SLOTS, MAX_TAB_SLOTS, sanitizeTabSlots, TAB_POOL } from "./navigation";

describe("sanitizeTabSlots", () => {
  it("falls back to the default for missing/invalid input", () => {
    expect(sanitizeTabSlots(undefined)).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots("notes")).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots([])).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots(["nope", 42])).toEqual(DEFAULT_TAB_SLOTS);
  });

  it("drops unknown ids and duplicates, keeps order, caps the count", () => {
    expect(sanitizeTabSlots(["calendar", "notes", "calendar", "bogus", "tags"])).toEqual([
      "calendar",
      "notes",
      "tags",
    ]);
    const all = TAB_POOL.map((t) => t.id);
    expect(sanitizeTabSlots(all)).toHaveLength(MAX_TAB_SLOTS);
  });

  it("returns a fresh array (callers mutate for reordering)", () => {
    const a = sanitizeTabSlots(undefined);
    const b = sanitizeTabSlots(undefined);
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_TAB_SLOTS);
  });
});
