import type { FetchFn } from "./WebDavSyncTarget.js";

/**
 * Microsoft identity platform OAuth 2.0 PKCE helpers for the OneDrive sync target
 * (sync-provider plan 2026-07-04, P3). Same split as DriveAuth: pure, unit-testable
 * URL building and token exchanges; the browser handoff and the loopback listener are
 * the desktop's (and the native layer's) job.
 *
 * Unlike Google, Microsoft treats desktop apps as PUBLIC clients: there is NO
 * client_secret anywhere in this flow — PKCE alone carries the security. The app
 * registration must be of type "Mobile and desktop applications" with redirect URI
 * `http://localhost` (which matches any loopback port, so the ephemeral-port
 * listener works unchanged).
 *
 * IMPORTANT: Microsoft ROTATES refresh tokens — a refresh response may carry a NEW
 * refresh_token that invalidates the old one. Callers must persist
 * `refreshToken` from every token result (the desktop wires this via the sync
 * target's onTokensRefreshed hook).
 */

export const ONEDRIVE_AUTH_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const ONEDRIVE_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
/** Files.ReadWrite = all files of the signed-in user; offline_access yields a refresh token. */
export const ONEDRIVE_DEFAULT_SCOPE = "Files.ReadWrite offline_access";

export interface OneDriveTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export function buildOneDriveAuthUrl(opts: {
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
    response_mode: "query",
    scope: opts.scope ?? ONEDRIVE_DEFAULT_SCOPE,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (opts.state) params.set("state", opts.state);
  return `${ONEDRIVE_AUTH_ENDPOINT}?${params.toString()}`;
}

function resolveFetch(fetchFn?: FetchFn): FetchFn {
  if (fetchFn) return fetchFn;
  if (typeof fetch !== "undefined") return fetch;
  throw new Error("No fetch available");
}

async function tokenRequest(body: URLSearchParams, fetchFn?: FetchFn): Promise<OneDriveTokenResult> {
  const f = resolveFetch(fetchFn);
  const res = await f(ONEDRIVE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    // Surface the concrete reason: Azure returns { error, error_description } and the
    // description's first line names the exact cause (e.g. AADSTS700016 wrong tenant,
    // AADSTS7000218 public-client flows off, redirect_uri mismatch).
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string; error_description?: string };
      detail = (err.error_description || err.error || "").split(/[\r\n]/)[0];
    } catch {
      /* body was not JSON */
    }
    throw new Error(
      `OneDrive token request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

/** Exchanges an authorization code for tokens (authorization_code grant, no secret). */
export async function exchangeOneDriveCode(
  opts: { clientId: string; code: string; codeVerifier: string; redirectUri: string; scope?: string },
  fetchFn?: FetchFn
): Promise<OneDriveTokenResult> {
  return tokenRequest(
    new URLSearchParams({
      client_id: opts.clientId,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      scope: opts.scope ?? ONEDRIVE_DEFAULT_SCOPE,
    }),
    fetchFn
  );
}

/** Refreshes tokens (refresh_token grant, no secret). May return a ROTATED refresh token. */
export async function refreshOneDriveAccessToken(
  opts: { clientId: string; refreshToken: string; scope?: string },
  fetchFn?: FetchFn
): Promise<OneDriveTokenResult> {
  return tokenRequest(
    new URLSearchParams({
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
      scope: opts.scope ?? ONEDRIVE_DEFAULT_SCOPE,
    }),
    fetchFn
  );
}
