import { describe, it, expect } from "vitest";
import { clampPeekSideWidth, PEEK_SIDE_DEFAULT, PEEK_SIDE_MIN, readPeekSideWidth, sidebarStepFor, SIDEBAR_STEP_COMPACT, SIDEBAR_STEP_MINIMAL, writePeekSideWidth } from "./lib/sidebarStep";

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

describe("peek window properties column (2026-09-04)", () => {
  it("never drops below the minimal step and never takes more than half the window body", () => {
    expect(clampPeekSideWidth(100, 1000)).toBe(PEEK_SIDE_MIN);
    expect(clampPeekSideWidth(300, 1000)).toBe(300);
    expect(clampPeekSideWidth(900, 1000)).toBe(500);
    // A tiny window still leaves the column its floor — the note pane yields.
    expect(clampPeekSideWidth(300, 400)).toBe(PEEK_SIDE_MIN);
  });

  it("remembers the width and falls back to the default for garbage", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
    writePeekSideWidth(333.6, storage);
    expect(readPeekSideWidth(storage)).toBe(334);
    m.set("plainva-peek-side-width", "nope");
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
    m.set("plainva-peek-side-width", "50");
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
  });
});
