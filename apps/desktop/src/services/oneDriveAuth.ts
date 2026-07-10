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
/**
 * Runs the OAuth flow and RETURNS the fresh credentials without persisting them
 * (splash onboarding authorizes before the local vault folder exists). The
 * vault-bound `runOneDriveAuthorization` below wraps this and persists.
 */
export async function authorizeOneDrive(opts: {
  clientId: string;
}): Promise<{ clientId: string; refreshToken: string }> {
  const { clientId } = opts;

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

  return { clientId, refreshToken: tokens.refreshToken };
}

export async function runOneDriveAuthorization(opts: {
  clientId: string;
  vaultPath: string;
}): Promise<void> {
  const creds = await authorizeOneDrive(opts);
  const existing = await credentialManager.getOneDriveCredentials(opts.vaultPath);
  await credentialManager.saveOneDriveCredentials(opts.vaultPath, {
    ...creds,
    rootFolderName: existing?.rootFolderName,
  });
}
