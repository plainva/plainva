// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { within } from "../../../packages/core/test/helpers/timeBudget";

/**
 * The shared test setup (scripts/vitest-shared-setup.mjs) gives jsdom Node's
 * native base64: jsdom's own took 6.9 s for a 2.8 MB attachment
 * (composeForwardFiles, 2026-11-10), which the WebView does in milliseconds.
 */
describe("base64 in the jsdom tests", () => {
  it("is as fast as the app's and keeps the rules of the platform's", () => {
    const big = "x".repeat(3_000_000);
    // jsdom's own took seconds for this; the native one, milliseconds.
    expect(within(1_000, () => atob(btoa(big))).length).toBe(big.length);
    expect(window.btoa("hi")).toBe("aGk=");
    expect(() => btoa(String.fromCharCode(0x100))).toThrow();
  });
});
