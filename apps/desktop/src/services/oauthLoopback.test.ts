import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { cancelOAuthLoopback, oauthErrorText } from "./oauthLoopback";
import i18n from "@plainva/ui/i18n";
import { ServiceConnectionError } from "@plainva/ui";

/**
 * What the app says when a consent tab is closed (N1/S1).
 *
 * The freeze itself was fixed earlier — the wait runs on a worker thread, so
 * the window stays alive. What was still missing is an ANSWER: the form printed
 * the raw `oauth loopback timed out`, an English sentence about an internal
 * mechanism, to someone who simply closed a browser tab.
 */
describe("turning a loopback failure into something a person can read", () => {
  it("names the two ways a sign-in ends without a redirect", async () => {
    await i18n.changeLanguage("en");
    expect(oauthErrorText(new Error("oauth loopback cancelled"))).toBe(i18n.t("settings.oauthCancelled"));
    expect(oauthErrorText(new Error("oauth loopback timed out"))).toBe(i18n.t("settings.oauthTimedOut"));
    // The marker may be wrapped by a caller; matching is on the marker, not equality.
    expect(oauthErrorText(new Error("drive: oauth loopback timed out after 180s"))).toBe(
      i18n.t("settings.oauthTimedOut"),
    );
  });

  /**
   * The provider's own words survive. "access_denied: the app is not verified"
   * says far more than any replacement of ours could, so the frame is all we add.
   */
  it("keeps what the provider said", () => {
    const text = oauthErrorText(new Error("oauth error in redirect: access_denied"));
    expect(text).toContain("access_denied");
  });

  /**
   * Anything that is not one of our codes keeps its own words — a generic
   * replacement would hide the one message that helps — but is framed as the
   * provider's answer, so it never reads like a sentence of Plainva's
   * (finding 2026-09-24).
   */
  it("keeps every other failure verbatim, framed as the provider's answer", async () => {
    await i18n.changeLanguage("en");
    expect(oauthErrorText(new Error("Address already in use (os error 98)"))).toBe(
      "Provider response: Address already in use (os error 98)",
    );
    expect(oauthErrorText("plain string")).toBe("Provider response: plain string");
  });

  /** Plainva's own codes never reach the screen raw — "storageFailed" did. */
  it("turns Plainva's own codes into sentences", async () => {
    await i18n.changeLanguage("en");
    expect(oauthErrorText(new ServiceConnectionError("storageFailed"))).toBe(
      "The sign-in worked, but the account data could not be saved on this device. Nothing was left half-created.",
    );
    expect(oauthErrorText(new ServiceConnectionError("needsConsent"))).toBe(i18n.t("connection.needsConsent"));
    for (const reason of ["accountChanged", "wrongAccount", "needsConsent", "identityUnavailable", "storageFailed"] as const) {
      expect(oauthErrorText(new ServiceConnectionError(reason))).not.toContain(reason);
    }
    expect(oauthErrorText(new Error(""))).toBe(i18n.t("connection.loginFailed"));
  });
});

describe("cancelling", () => {
  it("asks the native side to abort the wait", async () => {
    await cancelOAuthLoopback();
    expect(invoke).toHaveBeenCalledWith("oauth_loopback_cancel");
  });

  /**
   * Nothing pending is not an error: the redirect may have landed a moment
   * before the tap, and a cancel that throws would put a failure in front of a
   * sign-in that just succeeded.
   */
  it("never throws when there is nothing to stop", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("oauth listener not started"));
    await expect(cancelOAuthLoopback()).resolves.toBeUndefined();
  });
});
