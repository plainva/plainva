import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch } from "@tauri-apps/plugin-http";
import { generatePkcePair, buildAuthUrl, exchangeCode, generateCodeVerifier } from "@plainva/core";
import { credentialManager } from "./CredentialManager";

/**
 * Desktop OAuth glue (phase 5.1, G3). Drives the BYO Google Drive authorization end to
 * end by combining the native loopback listener (G2) with the stateless PKCE/token logic
 * (DriveAuth, G1):
 *
 *   start loopback -> build redirect_uri -> open the system browser to the auth URL ->
 *   wait for the redirect -> verify state -> exchange code -> persist refresh token.
 *
 * The Tauri http `fetch` is used for the token exchange (no webview CORS). The refresh
 * token is stored via CredentialManager (OS keychain, ADR 0005). Throws on any failure so
 * the caller can surface the message.
 */
export async function runDriveAuthorization(opts: {
  clientId: string;
  clientSecret: string;
  vaultPath: string;
}): Promise<void> {
  const { clientId, clientSecret, vaultPath } = opts;

  // 1. Bind the loopback listener and learn its ephemeral port up front, so the
  //    redirect_uri is fixed before we send the user to Google.
  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://127.0.0.1:${port}`;

  // 2. PKCE + a random state for CSRF protection.
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildAuthUrl({ clientId, redirectUri, codeChallenge, state });

  // 3. Open the system browser, then wait for the single redirect on the loopback.
  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", {
    timeoutSecs: 180,
  });
  if (redirect.state !== state) {
    throw new Error("OAuth-State stimmt nicht überein (möglicher CSRF) – Anmeldung abgebrochen.");
  }

  // 4. Exchange the code for tokens.
  const tokens = await exchangeCode(
    { clientId, clientSecret, code: redirect.code, codeVerifier, redirectUri },
    fetch
  );
  if (!tokens.refreshToken) {
    throw new Error(
      "Google hat keinen refresh_token geliefert. Den Plainva-Zugriff in den Google-Kontoeinstellungen entfernen und erneut verbinden."
    );
  }

  // 5. Persist alongside the BYO client (keychain), preserving any existing root folder.
  const existing = await credentialManager.getDriveCredentials(vaultPath);
  await credentialManager.saveDriveCredentials(vaultPath, {
    clientId,
    clientSecret,
    refreshToken: tokens.refreshToken,
    rootFolderName: existing?.rootFolderName,
  });
}
