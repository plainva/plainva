import { describe, it, expect } from "vitest";
import { sidebarStepFor, SIDEBAR_STEP_COMPACT, SIDEBAR_STEP_MINIMAL } from "./lib/sidebarStep";

/**
 * The three named steps of the right sidebar (plan P3). Naming them is the
 * point: every surface degrades at the SAME two widths, so the result can be
 * described in one table instead of "it depends on the section".
 */
describe("sidebarStepFor", () => {
  it("keeps the comfortable layout at and above 280 px", () => {
    expect(sidebarStepFor(600)).toBe("comfortable");
    expect(sidebarStepFor(SIDEBAR_STEP_COMPACT)).toBe("comfortable");
  });

  it("switches to compact just below 280 px", () => {
    expect(sidebarStepFor(SIDEBAR_STEP_COMPACT - 1)).toBe("compact");
    expect(sidebarStepFor(SIDEBAR_STEP_MINIMAL)).toBe("compact");
  });

  it("switches to minimal below 232 px", () => {
    expect(sidebarStepFor(SIDEBAR_STEP_MINIMAL - 1)).toBe("minimal");
    // The panel cannot be dragged below 200 px, so this is the floor in practice.
    expect(sidebarStepFor(200)).toBe("minimal");
  });

  it("has no gap and no overlap between the steps", () => {
    const seen = new Set<string>();
    for (let w = 150; w <= 600; w++) seen.add(sidebarStepFor(w));
    expect([...seen].sort()).toEqual(["comfortable", "compact", "minimal"]);
  });
});
