import { describe, expect, it } from "vitest";
import { accountRowState } from "./deviceSignIn";

/**
 * Findings P6.1: an account row has THREE states, not two.
 *
 * The state used to come from one question — "is there a credential slot on this
 * device" — which cannot tell a working sign-in from a dead one. A Google
 * refresh token issued by a BYO project whose consent screen sits in "testing"
 * expires after seven days: the slot stays full, every sync fails, and the row
 * said "aktiv" while the calendar stayed empty (§2.9).
 *
 * The combinator is pure and deliberately narrow, which is the half these tests
 * mostly guard: only a failure that re-authorising actually FIXES may turn the
 * row red. Offering "sign in again" for a dead network or a wrong client id
 * sends the user through a consent flow that cannot help.
 */

describe("accountRowState", () => {
  it("keeps a working account active", () => {
    expect(accountRowState("active", null)).toBe("active");
    expect(accountRowState("active", undefined)).toBe("active");
    expect(accountRowState("active", "")).toBe("active");
  });

  it("reports an expired grant even though the credential slot is full", () => {
    // Both providers say invalid_grant for revoked/expired; the core keeps the
    // machine-readable code in the message precisely so this can be read.
    expect(accountRowState("active", "400 Bad Request: invalid_grant")).toBe("expired");
    expect(accountRowState("active", "AADSTS700082: refresh token expired")).toBe("expired");
  });

  it("does NOT read a network failure as an expired sign-in", () => {
    // The counter-proof for the narrow rule: this one fixes itself, and a
    // "sign in again" button here would be a dead end dressed up as a fix.
    expect(accountRowState("active", "Failed to fetch")).toBe("active");
    expect(accountRowState("active", "request timed out after 30s")).toBe("active");
  });

  it("does NOT read a broken app registration as an expired sign-in", () => {
    // A wrong client id / redirect is a trip to the provider console. Signing in
    // again would fail exactly the same way.
    expect(accountRowState("active", "unauthorized_client")).toBe("active");
    expect(accountRowState("active", "AADSTS90023: invalid request")).toBe("active");
  });

  it("leaves an unclassifiable failure active rather than guessing", () => {
    expect(accountRowState("active", "500 Internal Server Error")).toBe("active");
  });

  it("lets a missing credential win over any failure text", () => {
    // No credential at all is the more precise statement, and the fix is the
    // same — so the row must not claim the sign-in "expired" when there never
    // was one on this device.
    expect(accountRowState("signin", "invalid_grant")).toBe("signin");
    expect(accountRowState("signin", null)).toBe("signin");
  });
});
