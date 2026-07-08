import { describe, expect, it } from "vitest";
import { minimalDocChange } from "./textDiff";

const apply = (oldText: string, newText: string): string => {
  const change = minimalDocChange(oldText, newText);
  if (!change) return oldText;
  return oldText.slice(0, change.from) + change.insert + oldText.slice(change.to);
};

describe("minimalDocChange", () => {
  it("returns null for identical texts", () => {
    expect(minimalDocChange("abc", "abc")).toBeNull();
    expect(minimalDocChange("", "")).toBeNull();
  });

  it("computes minimal ranges for append, prepend, replace and delete", () => {
    expect(minimalDocChange("abc", "abcx")).toEqual({ from: 3, to: 3, insert: "x" });
    expect(minimalDocChange("abc", "xabc")).toEqual({ from: 0, to: 0, insert: "x" });
    expect(minimalDocChange("a MITTE z", "a NEU z")).toEqual({ from: 2, to: 7, insert: "NEU" });
    expect(minimalDocChange("a weg z", "a z")).toEqual({ from: 2, to: 6, insert: "" });
  });

  it("stays consistent when prefix and suffix overlap (repeated characters)", () => {
    expect(minimalDocChange("aa", "aba")).toEqual({ from: 1, to: 1, insert: "b" });
    expect(minimalDocChange("aaaa", "aa")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("round-trips arbitrary edits (apply(old, change) === new)", () => {
    const cases: Array<[string, string]> = [
      ["", "neu"],
      ["alt", ""],
      ["# Titel\n\n- a\n- b\n", "# Titel\n\n- a\n- geändert\n- b\n"],
      ["Zeile1\nZeile2\n", "Zeile1\r-ersetzt\n"],
      ["aaa bbb aaa", "aaa xxx aaa aaa"],
      ["😀😀", "😀x😀"],
    ];
    for (const [oldText, newText] of cases) {
      expect(apply(oldText, newText)).toBe(newText);
    }
  });
});
