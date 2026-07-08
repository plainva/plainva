import { describe, it, expect } from "vitest";
import { EMOJI_CATEGORIES, searchEmoji } from "./emojiData";

describe("EMOJI_CATEGORIES", () => {
  it("has all 8 category ids, unique and non-empty", () => {
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice().sort()).toEqual(
      ["activities", "animals", "food", "objects", "people", "smileys", "symbols", "travel"],
    );
    for (const category of EMOJI_CATEGORIES) {
      expect(category.emoji.length).toBeGreaterThan(0);
    }
  });

  it("has unique chars across categories and non-empty names", () => {
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emoji);
    const chars = all.map((e) => e.char);
    expect(new Set(chars).size).toBe(chars.length);
    for (const entry of all) {
      expect(entry.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("has a total count between 300 and 600", () => {
    const total = EMOJI_CATEGORIES.reduce((n, c) => n + c.emoji.length, 0);
    expect(total).toBeGreaterThanOrEqual(300);
    expect(total).toBeLessThanOrEqual(600);
  });
});

describe("searchEmoji", () => {
  it("finds the rocket by name", () => {
    expect(searchEmoji("rocket").some((e) => e.char === "🚀")).toBe(true);
  });

  it("finds entries via keywords", () => {
    expect(searchEmoji("launch").some((e) => e.char === "🚀")).toBe(true);
  });

  it("returns [] for empty and whitespace-only queries", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(searchEmoji("ROCKET").some((e) => e.char === "🚀")).toBe(true);
    expect(searchEmoji("RoCkEt").some((e) => e.char === "🚀")).toBe(true);
  });

  it("caps results at 60", () => {
    // Single letters match broadly across names and keywords.
    for (const q of ["a", "e", "o"]) {
      expect(searchEmoji(q).length).toBeLessThanOrEqual(60);
    }
  });
});
