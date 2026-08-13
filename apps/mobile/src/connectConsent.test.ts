import { describe, expect, it } from "vitest";

import { brokerFamilyOf, canSkipConsent, consentServicesOf, runConsentScope } from "./services/connectConsent";

/**
 * Three services must not cost three consents (S0b3).
 *
 * Google and Microsoft share ONE account token since cloud accounts stage B.
 * The connect run would have undone that on the phone — a consent per screen
 * means a refresh token per service, which is the arrangement stage B removed.
 * The rules below decide when one consent covers the whole run.
 */
describe("what one consent covers", () => {
  it("only Google and Microsoft share a token", () => {
    expect(brokerFamilyOf("google")).toBe("google");
    expect(brokerFamilyOf("microsoft")).toBe("microsoft");
    for (const other of ["fastmail", "webdav", "dropbox", "apple", "s3"] as const) {
      expect(brokerFamilyOf(other)).toBeNull();
    }
  });

  /**
   * Both exclusions are about what the token would be USED for. Gmail signs in
   * with an app password and never enters an OAuth consent; Microsoft mail
   * could run on a broker, but no shell registers a mail token resolver, so a
   * mail scope here would be a wider consent with no consumer.
   */
  it("leaves mail out of the shared consent", () => {
    expect(consentServicesOf("google", ["files", "calendar", "mail"])).toEqual(["files", "calendar"]);
    expect(consentServicesOf("microsoft", ["files", "calendar", "mail"])).toEqual(["files", "calendar"]);
  });

  it("drops services the family cannot carry", () => {
    // Apple is not a broker family at all, so nothing is shared there; the
    // filter still has to hold for the two that are.
    expect(consentServicesOf("google", ["calendar"])).toEqual(["calendar"]);
  });
});

describe("when the first consent is widened", () => {
  it("asks for the union once a run covers two OAuth services", () => {
    const scope = runConsentScope("google", ["files", "calendar"]);
    expect(scope).toBeTruthy();
    // Both halves, in ONE consent — that is the whole point.
    expect(scope).toContain("drive");
    expect(scope).toContain("calendar");
  });

  /**
   * A single-service run must keep the provider default. Asking for more than
   * the run will use is permission creep, and it would hit the direct entry
   * point ("connect with cloud") too, which has no run at all.
   */
  it("keeps the provider default for a single service", () => {
    expect(runConsentScope("google", ["files"])).toBeNull();
    expect(runConsentScope("microsoft", ["calendar"])).toBeNull();
    expect(runConsentScope("google", [])).toBeNull();
  });

  it("keeps the provider default for families that share nothing", () => {
    expect(runConsentScope("fastmail", ["files", "calendar", "mail"])).toBeNull();
    expect(runConsentScope("webdav", ["files", "calendar"])).toBeNull();
  });

  /**
   * Microsoft with all three: mail stays out, so the widened consent covers
   * files and calendar and mail keeps its own. Two prompts instead of three —
   * and this is the assertion that says so out loud.
   */
  it("does not widen for mail alongside one other service", () => {
    expect(runConsentScope("microsoft", ["files", "mail"])).toBeNull();
    expect(runConsentScope("microsoft", ["files", "calendar", "mail"])).toBeTruthy();
  });
});

describe("which services skip their own consent", () => {
  const run = ["files", "calendar", "mail"] as const;

  it("skips only once an account token is actually there", () => {
    expect(canSkipConsent("google", run, "calendar", true)).toBe(true);
    expect(canSkipConsent("google", run, "calendar", false)).toBe(false);
  });

  it("never skips mail — it has no broker to fall back on", () => {
    expect(canSkipConsent("microsoft", run, "mail", true)).toBe(false);
  });

  it("never skips for a family without a shared token", () => {
    expect(canSkipConsent("fastmail", run, "calendar", true)).toBe(false);
  });
});
