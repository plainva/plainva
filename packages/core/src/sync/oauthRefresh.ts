/**
 * The one place that renews an OAuth access token (C6/S19).
 *
 * Four call sites used to carry their own `grant_type=refresh_token` — Google
 * twice, OneDrive and Dropbox once each — and the cost of that was measurable
 * rather than theoretical: the rule "a 200 without a token is not a token"
 * (finding 2026-07-30) had reached two of the four, and one of the two that
 * lacked it was a Google path whose sibling carried a comment claiming the rule
 * held for Google. A refresh that hands `undefined` on turns every later call
 * into `Bearer undefined`, which the provider answers with an authentication
 * error for something that never authenticated — cached for the token's
 * supposed lifetime.
 *
 * Three rules live here, and only here:
 *
 * 1. A failed request is read for its REASON. The provider names it in the
 *    body (`invalid_grant` = the sign-in is gone, `invalid_client` = the
 *    registration is wrong), and the code stays verbatim in the message: it
 *    travels through the PIM cache as a plain string and is what the UI
 *    classifies on.
 * 2. A 200 without an access token fails HERE, not two layers later.
 * 3. A rotated refresh token is passed back to the caller. Microsoft and
 *    Dropbox rotate; losing that rotation locks the next app start out.
 *
 * What deliberately does NOT live here is the transport. `DriveSyncTarget`
 * renews through its own retry wrapper, and pulling that in would have meant
 * one function with a switch in it — the opposite of the point. It uses
 * `refreshTokenBody` + `readRefreshResponse` and keeps its transport.
 */

import { oauthErrorMessage } from "./oauthError.js";
import type { FetchFn } from "./WebDavSyncTarget.js";

export interface OAuthRefreshResult {
  accessToken: string;
  /** Present when the provider ROTATED it; the caller must persist it. */
  refreshToken?: string;
  expiresIn?: number;
  /** What the provider actually granted — Google ignores a requested `scope`
   * on refresh and answers with the consent's own set (finding 2026-07-30). */
  scope?: string;
}

/** The `refresh_token` grant body. Optional fields are omitted, not sent empty:
 * a public client that sends `client_secret=` is not the same request. */
export function refreshTokenBody(opts: {
  clientId: string;
  refreshToken: string;
  clientSecret?: string;
  scope?: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
    grant_type: "refresh_token",
  });
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret);
  if (opts.scope) body.set("scope", opts.scope);
  return body;
}

/** Rules 1–3 applied to a token response. Shared by every provider, including
 * the ones that bring their own transport. */
export async function readRefreshResponse(
  label: string,
  res: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }
): Promise<OAuthRefreshResult> {
  if (!res.ok) throw new Error(await oauthErrorMessage(label, res));
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new Error(`${label} returned no access token`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
  };
}

/** Renews a token over the default transport. */
export async function refreshOAuthToken(
  opts: {
    label: string;
    endpoint: string;
    clientId: string;
    refreshToken: string;
    clientSecret?: string;
    scope?: string;
  },
  fetchFn?: FetchFn
): Promise<OAuthRefreshResult> {
  const f: FetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  const res = await f(opts.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: refreshTokenBody(opts).toString(),
  });
  return readRefreshResponse(opts.label, res);
}
