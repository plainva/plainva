import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRIVE_DEFAULT_SCOPE, MissingRefreshTokenError, refreshTokenBody } from "@plainva/core";
import { tokenCoversService } from "@plainva/ui";

/**
 * Honest tokens (P4, finding 2026-08-19).
 *
 * Two lies had the same shape: the app recorded what it ASKED for and then
 * believed it. A Drive-only grant was written down as covering the calendar,
 * and an account whose token lives in the shared broker slot sent its
 * deliberately empty per-service token to the provider as a real request.
 */
describe("a token only claims what was granted", () => {
  it("covers nothing when the grant is unknown", () => {
    // Unknown must read as "no": sending the service to its own consent costs
    // one sign-in, believing a claim costs a permanent 401.
    expect(tokenCoversService({ clientId: "c", refreshToken: "r" }, "calendar", "google")).toBe(false);
  });

  it("covers the service only when the granted scope contains it", () => {
    const driveOnly = { clientId: "c", refreshToken: "r", scopes: DRIVE_DEFAULT_SCOPE };
    expect(tokenCoversService(driveOnly, "files", "google")).toBe(true);
    expect(tokenCoversService(driveOnly, "calendar", "google")).toBe(false);
  });
});

describe("refreshTokenBody", () => {
  it("refuses an empty refresh token instead of asking the provider", () => {
    // The empty per-service token of a broker account went out as a real
    // request and came back as `400 invalid_request` — surfacing in the FILE
    // sync as a server error, when the truth is "not signed in here".
    expect(() => refreshTokenBody({ clientId: "c", refreshToken: "" })).toThrow(MissingRefreshTokenError);
  });

  it("still omits the optional fields rather than sending them empty", () => {
    const body = refreshTokenBody({ clientId: "c", refreshToken: "r", clientSecret: "", scope: "" });
    expect(body.has("client_secret")).toBe(false);
    expect(body.has("scope")).toBe(false);
    expect(body.get("refresh_token")).toBe("r");
  });
});

/**
 * The two writers of an account token must both record the grant.
 *
 * Read from the source: both sit at the end of a browser consent, behind a
 * persisted transaction and the platform bridge, and a test that mocked all of
 * that would assert against its own mocks. What can regress is precisely a
 * `scopes:` line built from the REQUEST — and that is what this catches.
 */
describe("account tokens are written from the grant", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");

  it("bindRunTokenToAccount records the granted scope, never the requested union", () => {
    const source = read("connectConsent.ts");
    const call = source.slice(source.indexOf("await saveAccountToken("));
    expect(call).toContain("granted ? { scopes: granted }");
    expect(call.slice(0, call.indexOf("});"))).not.toContain("unionScopeFor(");
  });

  it("the account-login handler does the same", () => {
    const source = read("accountLogin.ts");
    const call = source.slice(source.indexOf("await saveAccountToken("));
    expect(call).toContain("granted ? { scopes: granted }");
    expect(call.slice(0, call.indexOf("});"))).not.toContain("unionScopeFor(");
  });
});
