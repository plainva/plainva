import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import {
  generatePkcePair,
  generateCodeVerifier,
  buildAuthUrl,
  exchangeCode,
  refreshDriveAccessToken,
  buildOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveAccessToken,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
  type PimAuthProvider,
} from "@plainva/core";
import { savePimCredentials, type PimStoredCredentials } from "./pimCredentials";

/**
 * Desktop OAuth glue for the PIM accounts. Reuses the file sync's building
 * blocks 1:1 — native loopback listener, PKCE cores of DriveAuth/OneDriveAuth
 * (both take a scope override) — only the SCOPES differ: Google calendar +
 * tasks ("sensitive", not restricted — no CASA), Microsoft delegated
 * Calendars/Tasks on the SAME public Entra app as the OneDrive sync.
 */

/** Runs the Google consent flow and returns the refresh token (not persisted —
 * the account id does not exist yet at authorize time). */
export async function authorizeGooglePim(opts: { clientId: string; clientSecret: string }): Promise<{ refreshToken: string }> {
  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://127.0.0.1:${port}`;
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildAuthUrl({ clientId: opts.clientId, redirectUri, codeChallenge, state, scope: GOOGLE_CALENDAR_SCOPES });
  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", { timeoutSecs: 180 });
  if (redirect.state !== state) throw new Error("OAuth state mismatch — aborted.");
  const tokens = await exchangeCode(
    { clientId: opts.clientId, clientSecret: opts.clientSecret, code: redirect.code, codeVerifier, redirectUri },
    httpFetch
  );
  if (!tokens.refreshToken) {
    throw new Error("Google returned no refresh_token. Remove Plainva's access in the Google account settings, then connect again.");
  }
  return { refreshToken: tokens.refreshToken };
}

/** Runs the Microsoft consent flow (Graph calendar/tasks scopes). */
export async function authorizeMicrosoftPim(opts: { clientId: string }): Promise<{ refreshToken: string }> {
  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://localhost:${port}`;
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildOneDriveAuthUrl({ clientId: opts.clientId, redirectUri, codeChallenge, state, scope: GRAPH_CALENDAR_SCOPES });
  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", { timeoutSecs: 180 });
  if (redirect.state !== state) throw new Error("OAuth state mismatch — aborted.");
  const tokens = await exchangeOneDriveCode(
    { clientId: opts.clientId, code: redirect.code, codeVerifier, redirectUri, scope: GRAPH_CALENDAR_SCOPES },
    httpFetch
  );
  if (!tokens.refreshToken) throw new Error("Microsoft returned no refresh_token — connect again.");
  return { refreshToken: tokens.refreshToken };
}

/**
 * PimAuthProvider for a stored account: caches the access token until shortly
 * before expiry, refreshes through the PKCE cores and — crucial for
 * Microsoft's refresh-token ROTATION — persists a rotated token immediately
 * (the file sync's hard-earned lesson: a dropped rotation kills the account).
 */
export function buildPimAuthProvider(
  vaultPath: string,
  accountId: string,
  creds: Extract<PimStoredCredentials, { kind: "google" | "microsoft" }>
): PimAuthProvider {
  let accessToken: string | null = null;
  let expiresAt = 0;
  let currentRefreshToken = creds.refreshToken;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    if (creds.kind === "google") {
      const res = await refreshDriveAccessToken(
        { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: currentRefreshToken },
        httpFetch
      );
      accessToken = res.accessToken;
      expiresAt = Date.now() + Math.max(60, (res.expiresIn ?? 3600) - 60) * 1000;
      return accessToken;
    }
    const res = await refreshOneDriveAccessToken(
      { clientId: creds.clientId, refreshToken: currentRefreshToken, scope: GRAPH_CALENDAR_SCOPES },
      httpFetch
    );
    accessToken = res.accessToken;
    expiresAt = Date.now() + Math.max(60, (res.expiresIn ?? 3600) - 60) * 1000;
    if (res.refreshToken && res.refreshToken !== currentRefreshToken) {
      currentRefreshToken = res.refreshToken;
      await savePimCredentials(vaultPath, accountId, { ...creds, refreshToken: res.refreshToken });
    }
    return accessToken;
  };

  return {
    async getAccessToken(force?: boolean): Promise<string> {
      if (!force && accessToken && Date.now() < expiresAt) return accessToken;
      // Single-flight: parallel calendar pulls must not race N refreshes
      // (Microsoft rotation would self-destruct).
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
