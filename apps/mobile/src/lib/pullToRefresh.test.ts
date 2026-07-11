import { describe, expect, it } from "vitest";
import { PULL_THRESHOLD, pullDistance } from "./usePullToRefresh";

describe("pull-to-refresh gesture math", () => {
  it("dampens the raw finger travel and never goes negative", () => {
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(80)).toBe(40);
  });

  it("caps the indicator distance", () => {
    expect(pullDistance(400)).toBe(96);
  });

  it("the threshold is reachable within the cap", () => {
    expect(PULL_THRESHOLD).toBeLessThanOrEqual(96);
    expect(pullDistance(PULL_THRESHOLD * 2)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
  });
});
