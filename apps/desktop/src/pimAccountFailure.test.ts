import { describe, expect, it } from "vitest";
import { classifyAuthError, pimAccountFailure, pimProviderName } from "@plainva/ui";

const t = (key: string, options?: Record<string, unknown>) => (options && "provider" in options ? `${key}(${String(options.provider)})` : key);

/**
 * A calendar account's failure in the settings (finding 2026-10-30): the phone
 * showed "The collections of this account could not be loaded." and a loose
 * "HTTP_NETWORK_ERROR" under it. The parts both shells draw now come from here.
 */
describe("pimAccountFailure", () => {
  it("reads the phone's native network error as no connection", () => {
    expect(classifyAuthError("HTTP_NETWORK_ERROR")).toBe("network");
    expect(pimAccountFailure("HTTP_NETWORK_ERROR", "google", t)).toEqual({
      title: "connectRun.noConnection",
      text: "pim.authNetwork",
      raw: "HTTP_NETWORK_ERROR",
      signIn: false,
    });
  });

  it("reads the desktop's request that never got an answer as no connection, a certificate not", () => {
    const view = pimAccountFailure("error sending request for url (https://dav.example.org/calendars/me/)", "caldav", t);
    expect(view.title).toBe("connectRun.noConnection");
    expect(view.text).toBe("pim.authNetwork");
    expect(pimAccountFailure("error sending request for url (https://x/): invalid peer certificate: UnknownIssuer", "caldav", t).text).not.toBe("pim.authNetwork");
  });

  it("keeps the provider's own words, small, for every failure", () => {
    const view = pimAccountFailure("400 Bad Request", "microsoft", t);
    expect(view.text).toBe("pim.accountFailed");
    expect(view.raw).toBe("400 Bad Request");
    expect(view.title).toBe("connectRun.providerRefused(Microsoft)");
  });

  it("an expired Google grant asks for a sign-in and keeps its background behind the info", () => {
    const view = pimAccountFailure("invalid_grant: Token has been expired or revoked.", "google", t);
    expect(view.signIn).toBe(true);
    expect(view.text).toBe("pim.authExpiredGoogleShort");
    expect(view.info).toBe("pim.authExpiredGoogle");
  });

  it("a switched-off API is said as such, not as a broken registration", () => {
    const view = pimAccountFailure("accessNotConfigured: Google Calendar API has not been used in project 1", "google", t);
    expect(view.text).toBe("pim.authApiDisabled");
    expect(view.info).toBeUndefined();
  });

  it("names a wrong app registration", () => {
    expect(pimAccountFailure("invalid_client", "microsoft", t).text).toBe("pim.authConfig");
  });

  it("names the provider instead of its id", () => {
    expect(["caldav", "google", "microsoft", "device", "other"].map((p) => pimProviderName(p, t)))
      .toEqual(["CalDAV", "Google", "Microsoft", "cloudAccounts.familyDevice", "other"]);
  });
});
