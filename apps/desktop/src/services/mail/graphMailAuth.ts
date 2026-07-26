import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePkcePair, generateCodeVerifier, buildOneDriveAuthUrl, exchangeOneDriveCode } from "@plainva/core";
import { GRAPH_MAIL_SCOPES } from "@plainva/ui/mail";
import { microsoftAuthFetch } from "../authFetch";

/**
 * The Microsoft consent flow for mail — the one genuinely shell-specific part
 * of the Graph backend (feinplan G0.1): the desktop opens the system browser
 * and catches the redirect on a loopback listener, mobile will use its
 * custom-scheme redirect instead. Everything after the token exchange is
 * shared (`@plainva/ui/mail`).
 *
 * Reuses the OneDrive PKCE cores 1:1 — only the SCOPES differ (delegated
 * Mail.ReadWrite + Mail.Send on the SAME central Entra app).
 */
export async function authorizeMicrosoftMail(opts: { clientId: string }): Promise<{ refreshToken: string }> {
  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://localhost:${port}`;
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildOneDriveAuthUrl({ clientId: opts.clientId, redirectUri, codeChallenge, state, scope: GRAPH_MAIL_SCOPES });
  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", { timeoutSecs: 180 });
  if (redirect.state !== state) throw new Error("OAuth state mismatch — aborted.");
  // microsoftAuthFetch, NOT the raw webview fetch: the token POST must carry no
  // Origin header (AADSTS90023 — maintainer finding 2026-07-20).
  const tokens = await exchangeOneDriveCode(
    { clientId: opts.clientId, code: redirect.code, codeVerifier, redirectUri, scope: GRAPH_MAIL_SCOPES },
    microsoftAuthFetch,
  );
  if (!tokens.refreshToken) throw new Error("Microsoft returned no refresh_token — connect again.");
  return { refreshToken: tokens.refreshToken };
}
