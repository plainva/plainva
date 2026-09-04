import { describe, expect, it } from "vitest";
import { parkedSuggestionBlocks, reconcileParkedSuggestion } from "@plainva/ui";

/**
 * A parked copy meets the note as it stands now (C34). The rule is the send
 * path's own: a block is found by the text it replaces; what cannot be found
 * is handed back rather than dropped.
 */
describe("reconciling a parked suggestion copy", () => {
  const base = "Alpha line.\n\nBeta line stays.\n\nGamma line.\n";
  const copy = "Alpha line, revised.\n\nBeta line stays.\n\nGamma line.\n\nDelta added.\n";

  it("hands the copy back untouched when the note has not changed", () => {
    expect(reconcileParkedSuggestion({ base, copy }, base)).toEqual({ copy, orphaned: [], rebased: false });
    expect(parkedSuggestionBlocks({ base, copy })).toBeGreaterThanOrEqual(2);
  });

  it("re-finds every block by its quote when text was added elsewhere", () => {
    const changed = "Intro paragraph.\n\n" + base;
    const out = reconcileParkedSuggestion({ base, copy }, changed);
    expect(out.rebased).toBe(true);
    expect(out.orphaned).toEqual([]);
    expect(out.copy).toContain("Alpha line, revised.");
    expect(out.copy).toContain("Delta added.");
    expect(out.copy.startsWith("Intro paragraph.")).toBe(true);
  });

  it("orphans a block whose passage is gone instead of guessing", () => {
    const changed = "Something else entirely.\n\nBeta line stays.\n\nGamma line.\n";
    const out = reconcileParkedSuggestion({ base, copy }, changed);
    expect(out.rebased).toBe(true);
    expect(out.orphaned.some((text) => text.includes("revised"))).toBe(true);
    expect(out.copy).toContain("Something else entirely.");
    expect(out.copy).toContain("Delta added.");
  });
});
