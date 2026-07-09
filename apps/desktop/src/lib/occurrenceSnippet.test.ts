import { describe, expect, it } from "vitest";
import { buildOccurrenceSnippet } from "./occurrenceSnippet";

describe("buildOccurrenceSnippet", () => {
  it("returns before/match/after untruncated for short content", () => {
    const c = "We met Projekt X today.";
    expect(buildOccurrenceSnippet(c, 7, "Projekt X".length)).toEqual({
      before: "We met ",
      match: "Projekt X",
      after: " today.",
    });
  });

  it("collapses newlines and repeated whitespace in the window", () => {
    const c = "line one\n\nBegriff\ntrailing";
    const idx = c.indexOf("Begriff");
    expect(buildOccurrenceSnippet(c, idx, "Begriff".length)).toEqual({
      before: "line one ",
      match: "Begriff",
      after: " trailing",
    });
  });

  it("adds an ellipsis on each truncated side", () => {
    const long = "x".repeat(60);
    const c = `${long} Begriff ${long}`;
    const idx = c.indexOf("Begriff");
    const s = buildOccurrenceSnippet(c, idx, "Begriff".length, 10);
    expect(s.match).toBe("Begriff");
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
  });
});
