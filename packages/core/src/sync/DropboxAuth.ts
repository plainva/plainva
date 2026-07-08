import type { FetchFn } from "./WebDavSyncTarget.js";

/**
 * Dropbox OAuth 2.0 PKCE helpers for the Dropbox sync target (sync-provider plan
 * 2026-07-04, P5). Public client — no app secret anywhere; PKCE carries the
 * security. `token_access_type=offline` requests a long-lived refresh token
 * (Dropbox does not force-rotate refresh tokens, unlike Microsoft).
 *
 * Dropbox requires the redirect URI to be registered EXACTLY (no wildcard ports
 * like Azure's `http://localhost`), so the loopback listener binds a FIXED port:
 * the app registration must whitelist `http://127.0.0.1:41953`.
 */

export const DROPBOX_AUTH_ENDPOINT = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
/** Fixed loopback port; must match the redirect URI registered in the Dropbox console. */
export const DROPBOX_LOOPBACK_PORT = 41953;
export const DROPBOX_REDIRECT_URI = `http://127.0.0.1:${DROPBOX_LOOPBACK_PORT}`;

export interface DropboxTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export function buildDropboxAuthUrl(opts: {
  appKey: string;
  redirectUri?: string;
  codeChallenge: string;
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.appKey,
    redirect_uri: opts.redirectUri ?? DROPBOX_REDIRECT_URI,
    response_type: "code",
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  });
  if (opts.state) params.set("state", opts.state);
  return `${DROPBOX_AUTH_ENDPOINT}?${params.toString()}`;
}

function resolveFetch(fetchFn?: FetchFn): FetchFn {
  if (fetchFn) return fetchFn;
  if (typeof fetch !== "undefined") return fetch;
  throw new Error("No fetch available");
}

async function tokenRequest(body: URLSearchParams, fetchFn?: FetchFn): Promise<DropboxTokenResult> {
  const f = resolveFetch(fetchFn);
  const res = await f(DROPBOX_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error_summary?: string; error_description?: string };
      detail = (err.error_summary || err.error_description || "").split(/[\r\n]/)[0];
    } catch {
      /* body was not JSON */
    }
    throw new Error(
      `Dropbox token request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
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
export async function exchangeDropboxCode(
  opts: { appKey: string; code: string; codeVerifier: string; redirectUri?: string },
  fetchFn?: FetchFn
): Promise<DropboxTokenResult> {
  return tokenRequest(
    new URLSearchParams({
      client_id: opts.appKey,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri ?? DROPBOX_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
    fetchFn
  );
}

/** Refreshes the short-lived access token using the long-lived refresh token. */
export async function refreshDropboxAccessToken(
  opts: { appKey: string; refreshToken: string },
  fetchFn?: FetchFn
): Promise<DropboxTokenResult> {
  return tokenRequest(
    new URLSearchParams({
      client_id: opts.appKey,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    }),
    fetchFn
  );
}
