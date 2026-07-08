import { describe, it, expect } from "vitest";
import { dirOf, isAncestorDir, rankCandidateBases } from "./baseSchema";

describe("baseSchema.dirOf", () => {
  it("returns the folder of a path", () => {
    expect(dirOf("a/b/c.md")).toBe("a/b");
    expect(dirOf("root.md")).toBe("");
  });
});

describe("baseSchema.isAncestorDir", () => {
  it("treats the vault root as an ancestor of everything", () => {
    expect(isAncestorDir("", "a/b.md")).toBe(true);
  });
  it("matches only true ancestor folders", () => {
    expect(isAncestorDir("Calendar", "Calendar/Tagebuch/x.md")).toBe(true);
    expect(isAncestorDir("Calendar/Tagebuch", "Calendar/Tagebuch/x.md")).toBe(true);
    expect(isAncestorDir("Efforts", "Calendar/Tagebuch/x.md")).toBe(false);
    expect(isAncestorDir("Cal", "Calendar/x.md")).toBe(false); // prefix, not a folder boundary
  });
});

describe("baseSchema.rankCandidateBases", () => {
  it("keeps only ancestor bases, most-specific (deepest folder) first", () => {
    const bases = [
      "Calendar/Tagebuch_Liste.base",
      "Calendar/Tagebuch/Daily.base",
      "Efforts/Projekte.base",
      "Root.base",
    ];
    expect(rankCandidateBases(bases, "Calendar/Tagebuch/2026-06-23.md")).toEqual([
      "Calendar/Tagebuch/Daily.base",
      "Calendar/Tagebuch_Liste.base",
      "Root.base",
    ]);
  });
  it("excludes the note itself and non-ancestors", () => {
    expect(rankCandidateBases(["Other/x.base"], "Calendar/n.md")).toEqual([]);
  });
});
