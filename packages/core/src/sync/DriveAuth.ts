import type { FetchFn } from "./WebDavSyncTarget.js";

/**
 * Google OAuth 2.0 PKCE helper for the BYO Google Drive flow (phase 5.1, G1; ADR 0006).
 *
 * Pure, stateless logic that is fully unit-testable in the harness: PKCE pair
 * generation, authorization-URL building and the code/refresh token exchanges. It does
 * NOT open a browser and does NOT receive the redirect — those are the native loopback
 * listener (G2, maintainer-verified) and the desktop glue (G3). `redirectUri` is a plain
 * parameter so the caller can pass the loopback URL once the native listener has bound
 * its ephemeral port.
 */

export const DRIVE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const DRIVE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// Full Drive access (ADR 0006, revised 2026-06-25): required so the sync sees files
// added to the folder outside Plainva (Drive web UI, other devices/apps), not just
// app-created ones. This is a *restricted* scope -> a public release needs Google
// verification + CASA; in "testing" publishing status it works for <=100 test users
// (refresh tokens then expire after 7 days).
export const DRIVE_DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface DriveTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RFC 7636 code verifier: 32 random bytes base64url-encoded -> 43 chars, all from the
 * unreserved set [A-Za-z0-9-._~].
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** RFC 7636 S256 challenge: base64url(SHA-256(ASCII(verifier))). */
export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await pkceChallengeFromVerifier(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/**
 * Builds the Google authorization URL. `access_type=offline` + `prompt=consent` ensure a
 * refresh_token is returned (Google omits it on repeat consents otherwise).
 */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope ?? DRIVE_DEFAULT_SCOPE,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  if (opts.state) params.set("state", opts.state);
  return `${DRIVE_AUTH_ENDPOINT}?${params.toString()}`;
}

function resolveFetch(fetchFn?: FetchFn): FetchFn {
  if (fetchFn) return fetchFn;
  if (typeof fetch !== "undefined") return fetch;
  throw new Error("No fetch available");
}

/** Exchanges an authorization code for access + refresh tokens (authorization_code grant). */
export async function exchangeCode(
  opts: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  fetchFn?: FetchFn
): Promise<DriveTokenResult> {
  const f = resolveFetch(fetchFn);
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await f(DRIVE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Drive token exchange failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
}

/** Refreshes an access token using a stored refresh token (refresh_token grant). */
export async function refreshDriveAccessToken(
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  fetchFn?: FetchFn
): Promise<DriveTokenResult> {
  const f = resolveFetch(fetchFn);
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await f(DRIVE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Drive token refresh failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}
