import { describe, expect, it } from "vitest";
import { classifyAuthError, isApiNotEnabled, needsReauthorisation, NO_STORED_SIGN_IN } from "@plainva/ui";
import { formatOAuthError, parseOAuthErrorBody } from "@plainva/core";

/**
 * The chain this covers: a provider rejects a token request, the core keeps the
 * machine-readable code in the message, the message survives as a plain string
 * in the PIM cache, and the settings turn it back into an instruction.
 *
 * The case that started it (2026-07-28): a Google calendar reporting
 * `400 Bad Request` next to a "Try again" button, while the actual answer was
 * `invalid_grant` — a retry could never have helped.
 */
describe("OAuth error body", () => {
  it("keeps the code and the first line of the description", () => {
    const detail = parseOAuthErrorBody({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.\nsecond line",
    });
    expect(detail).toEqual({ code: "invalid_grant", description: "Token has been expired or revoked." });
  });

  it("survives a body that is not the expected shape", () => {
    expect(parseOAuthErrorBody(null)).toEqual({});
    expect(parseOAuthErrorBody("nope")).toEqual({});
    expect(parseOAuthErrorBody({ error: 42 })).toEqual({});
  });

  it("puts the code into the message so it can be classified later", () => {
    const message = formatOAuthError("Google token refresh failed", 400, "Bad Request", {
      code: "invalid_grant",
      description: "Token has been expired or revoked.",
    });
    expect(message).toBe(
      "Google token refresh failed: 400 Bad Request — invalid_grant: Token has been expired or revoked."
    );
    expect(classifyAuthError(message)).toBe("expired");
  });

  it("still reads as before when the provider sent no body", () => {
    expect(formatOAuthError("Google token refresh failed", 400, "Bad Request", {})).toBe(
      "Google token refresh failed: 400 Bad Request"
    );
  });
});

describe("classifyAuthError", () => {
  it("treats a lost authorisation as expired, whoever reported it", () => {
    expect(classifyAuthError("Google token refresh failed: 400 Bad Request — invalid_grant")).toBe("expired");
    expect(classifyAuthError("Microsoft token request failed: 400 Bad Request — AADSTS700082: expired")).toBe("expired");
    expect(needsReauthorisation("… invalid_grant …")).toBe(true);
  });

  it("separates a misconfigured client from an expired sign-in", () => {
    expect(classifyAuthError("Microsoft token request failed: 400 — AADSTS7000218: public client flows")).toBe("config");
    expect(classifyAuthError("… invalid_client: The OAuth client was not found.")).toBe("config");
    expect(needsReauthorisation("… invalid_client …")).toBe(false);
  });

  it("recognises the case where retrying IS the answer", () => {
    expect(classifyAuthError("Failed to fetch")).toBe("network");
    expect(classifyAuthError("request timed out after 30s")).toBe("network");
  });

  it("says unknown rather than guessing", () => {
    expect(classifyAuthError("something went sideways")).toBe("unknown");
    expect(classifyAuthError(undefined)).toBe("unknown");
    expect(classifyAuthError("")).toBe("unknown");
  });
});

describe("a missing stored sign-in (finding 2026-07-30)", () => {
  it("routes Microsoft's empty-refresh answer to signing in again", () => {
    // What the maintainer's calendar showed. It describes OUR request — the body
    // carried no refresh_token — but a person can only ever reach it once the
    // stored sign-in is gone, and the banner was offering a retry that could not
    // work. Before this it classified as "unknown".
    const msg =
      "Microsoft token request failed: 400 — invalid_request: AADSTS900144: The request body must contain the following parameter: 'refresh_token'.";
    expect(classifyAuthError(msg)).toBe("expired");
    expect(needsReauthorisation(msg)).toBe(true);
  });

  it("routes our own marker and the broker's wording the same way", () => {
    expect(needsReauthorisation(`${NO_STORED_SIGN_IN}: this account has no stored sign-in — connect it again.`)).toBe(true);
    expect(needsReauthorisation("account is not connected")).toBe(true);
  });

  it("still does not read a network failure as a lost sign-in", () => {
    expect(needsReauthorisation("Failed to fetch")).toBe(false);
  });
});


describe("Google's REST errors (finding 2026-07-30)", () => {
  it("reads a 401 on the calendar list as a lost sign-in", () => {
    // What the maintainer's Google account showed. The status alone said
    // nothing; the body names the reason, and this one is repaired by signing
    // in again.
    const msg =
      "google api 401 (UNAUTHENTICATED: Request had invalid authentication credentials.) for https://www.googleapis.com/calendar/v3/users/me/calendarList";
    expect(classifyAuthError(msg)).toBe("expired");
    expect(needsReauthorisation(msg)).toBe(true);
  });

  it("reads a missing scope as a lost sign-in too — the consent is what changes", () => {
    const msg =
      "google api 403 (insufficientPermissions: Request had insufficient authentication scopes.) for https://www.googleapis.com/calendar/v3/users/me/calendarList";
    expect(needsReauthorisation(msg)).toBe(true);
  });

  it("does NOT offer a sign-in when the API is switched off in the user's project", () => {
    // A button cannot enable an API in someone's Google Cloud console, and
    // offering one would be a dead end wearing the clothes of a fix.
    const msg =
      "google api 403 (accessNotConfigured: Google Calendar API has not been used in project 123 before or it is disabled.) for https://www.googleapis.com/calendar/v3/users/me/calendarList";
    expect(classifyAuthError(msg)).toBe("config");
    expect(needsReauthorisation(msg)).toBe(false);
  });

  it("keeps a bare status unclassified rather than guessing", () => {
    expect(classifyAuthError("google api 500 for https://www.googleapis.com/calendar/v3/users/me/calendarList")).toBe("unknown");
  });
});

describe("isApiNotEnabled (finding 2026-07-30)", () => {
  it("separates the switched-off API from a wrong registration", () => {
    // Both are "the console, not the app" — but telling someone to check
    // client id, secret and redirect URI sends them to look at three things
    // that are all correct.
    expect(isApiNotEnabled("google api 403 (accessNotConfigured: Google Calendar API has not been used in project 42.)")).toBe(true);
    expect(isApiNotEnabled("invalid_client: The OAuth client was not found.")).toBe(false);
    expect(isApiNotEnabled("google api 401 (UNAUTHENTICATED: Request had invalid authentication credentials.)")).toBe(false);
  });
});
