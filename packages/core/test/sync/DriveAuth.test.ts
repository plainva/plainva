import { describe, it, expect, vi } from "vitest";
import {
  generateCodeVerifier,
  pkceChallengeFromVerifier,
  generatePkcePair,
  buildAuthUrl,
  exchangeCode,
  refreshDriveAccessToken,
  DRIVE_TOKEN_ENDPOINT,
} from "../../src/sync/DriveAuth.js";

function res(body: any, init: { ok?: boolean; status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

describe("DriveAuth PKCE", () => {
  it("derives the S256 challenge per the RFC 7636 test vector", async () => {
    // RFC 7636 Appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallengeFromVerifier(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates an unreserved-charset verifier paired with its own challenge", async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(codeChallenge).toBe(await pkceChallengeFromVerifier(codeVerifier));
    // Two calls must not collide.
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("DriveAuth URL + token exchange", () => {
  it("builds an auth URL requesting offline access and S256", () => {
    const url = buildAuthUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:51789",
      codeChallenge: "CHALLENGE",
      state: "xyz",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51789");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges an authorization code for access + refresh tokens", async () => {
    const fetchFn = vi.fn(async () => res({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
    const result = await exchangeCode(
      { clientId: "cid", clientSecret: "sec", code: "abc", codeVerifier: "ver", redirectUri: "http://127.0.0.1:1" },
      fetchFn
    );
    expect(result).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
    const [calledUrl, init] = fetchFn.mock.calls[0] as any;
    expect(calledUrl).toBe(DRIVE_TOKEN_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.body).toContain("grant_type=authorization_code");
    expect(init.body).toContain("code_verifier=ver");
  });

  it("refreshes an access token with the refresh_token grant", async () => {
    const fetchFn = vi.fn(async () => res({ access_token: "fresh", expires_in: 3600 }));
    const result = await refreshDriveAccessToken({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" }, fetchFn);
    expect(result.accessToken).toBe("fresh");
    const [, init] = fetchFn.mock.calls[0] as any;
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain("refresh_token=rt");
  });

  it("throws on a non-ok token response", async () => {
    const fetchFn = vi.fn(async () => res({ error: "invalid_grant" }, { status: 400 }));
    await expect(
      exchangeCode({ clientId: "c", clientSecret: "s", code: "x", codeVerifier: "v", redirectUri: "r" }, fetchFn)
    ).rejects.toThrow(/token exchange failed/);
  });
});
