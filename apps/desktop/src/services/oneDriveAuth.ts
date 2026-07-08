import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  generatePkcePair,
  generateCodeVerifier,
  buildOneDriveAuthUrl,
  exchangeOneDriveCode,
} from "@plainva/core";
import { credentialManager } from "./CredentialManager";
import { oneDriveFetch } from "./authFetch";

/**
 * Desktop OAuth glue for OneDrive (sync-provider plan 2026-07-04, P9). Same shape as
 * runDriveAuthorization: loopback listener -> system browser -> code exchange ->
 * keychain persistence. Differences to Google: PUBLIC client (no secret anywhere),
 * and the redirect uses `http://localhost:<port>` — Azure's registered
 * `http://localhost` redirect matches ANY loopback port, so the ephemeral listener
 * works unchanged (the listener itself binds 127.0.0.1, which localhost resolves to).
 */
export async function runOneDriveAuthorization(opts: {
  clientId: string;
  vaultPath: string;
}): Promise<void> {
  const { clientId, vaultPath } = opts;

  const port = await invoke<number>("oauth_loopback_start");
  const redirectUri = `http://localhost:${port}`;

  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildOneDriveAuthUrl({ clientId, redirectUri, codeChallenge, state });

  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", {
    timeoutSecs: 180,
  });
  if (redirect.state !== state) {
    throw new Error("OAuth-State stimmt nicht überein (möglicher CSRF) – Anmeldung abgebrochen.");
  }

  const tokens = await exchangeOneDriveCode(
    { clientId, code: redirect.code, codeVerifier, redirectUri },
    oneDriveFetch
  );
  if (!tokens.refreshToken) {
    throw new Error(
      "Microsoft hat keinen refresh_token geliefert. Prüfe, ob die App-Registrierung den Scope offline_access erlaubt, und verbinde erneut."
    );
  }

  const existing = await credentialManager.getOneDriveCredentials(vaultPath);
  await credentialManager.saveOneDriveCredentials(vaultPath, {
    clientId,
    refreshToken: tokens.refreshToken,
    rootFolderName: existing?.rootFolderName,
  });
}
