import { describe, expect, it } from "vitest";
import { isRetiredPlainvaClient, retiredAccessReplacement } from "@plainva/ui";

/**
 * Plainva's first Google project (`plainva-spike`) is retired (K7, 2026-10-26).
 * No build ever shipped one of its clients; testers entered them as their own
 * while there was no standard sign-in, and Google now answers
 * "Error 401: deleted_client". Each device moves back to the standard once.
 */
describe("the retired Google project", () => {
  it("knows its clients by the project number", () => {
    expect(isRetiredPlainvaClient("google", "835308879715-bim1pgh5example.apps.googleusercontent.com")).toBe(true);
    expect(isRetiredPlainvaClient("google", " 835308879715-bim1pgh5example.apps.googleusercontent.com ")).toBe(true);
    expect(isRetiredPlainvaClient("google", "801036557296-x.apps.googleusercontent.com")).toBe(false);
    expect(isRetiredPlainvaClient("google", "8353088797150-x.apps.googleusercontent.com")).toBe(false);
    expect(isRetiredPlainvaClient("microsoft", "835308879715-x")).toBe(false);
    expect(isRetiredPlainvaClient("google", undefined)).toBe(false);
  });

  it("replaces only an own access with such a client", () => {
    expect(retiredAccessReplacement("google", { source: "own", clientId: "835308879715-bim1pgh5example.apps.googleusercontent.com", clientSecret: "s" })).toEqual({ source: "plainva" });
    expect(retiredAccessReplacement("google", { source: "own", clientId: "123456789012-mine.apps.googleusercontent.com" })).toBeNull();
    expect(retiredAccessReplacement("google", { source: "plainva" })).toBeNull();
    expect(retiredAccessReplacement("google", null)).toBeNull();
  });
});
