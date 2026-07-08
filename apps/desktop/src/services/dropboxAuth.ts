import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch } from "@tauri-apps/plugin-http";
import {
  generatePkcePair,
  generateCodeVerifier,
  buildDropboxAuthUrl,
  exchangeDropboxCode,
  DROPBOX_LOOPBACK_PORT,
  DROPBOX_REDIRECT_URI,
} from "@plainva/core";
import { credentialManager } from "./CredentialManager";

/**
 * Desktop OAuth glue for Dropbox (sync-provider plan 2026-07-04, P9). Dropbox
 * requires the redirect URI to be registered EXACTLY, so the loopback listener
 * binds the FIXED port from DROPBOX_LOOPBACK_PORT (the app registration must
 * whitelist DROPBOX_REDIRECT_URI, plan item M-B). A bind failure (port in use)
 * surfaces as a readable error instead of a silent hang.
 */
export async function runDropboxAuthorization(opts: {
  appKey: string;
  vaultPath: string;
}): Promise<void> {
  const { appKey, vaultPath } = opts;

  let port: number;
  try {
    port = await invoke<number>("oauth_loopback_start", { port: DROPBOX_LOOPBACK_PORT });
  } catch (e) {
    throw new Error(
      `Der lokale Anmelde-Port ${DROPBOX_LOOPBACK_PORT} ist belegt (${e instanceof Error ? e.message : e}). Bitte blockierende Anwendung schließen und erneut versuchen.`,
      { cause: e }
    );
  }
  const redirectUri = `http://127.0.0.1:${port}`;
  if (redirectUri !== DROPBOX_REDIRECT_URI) {
    throw new Error(`Unerwarteter Loopback-Port ${port} – erwartet ${DROPBOX_LOOPBACK_PORT}.`);
  }

  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = generateCodeVerifier();
  const authUrl = buildDropboxAuthUrl({ appKey, redirectUri, codeChallenge, state });

  await openUrl(authUrl);
  const redirect = await invoke<{ code: string; state: string | null }>("oauth_loopback_wait", {
    timeoutSecs: 180,
  });
  if (redirect.state !== state) {
    throw new Error("OAuth-State stimmt nicht überein (möglicher CSRF) – Anmeldung abgebrochen.");
  }

  const tokens = await exchangeDropboxCode(
    { appKey, code: redirect.code, codeVerifier, redirectUri },
    fetch
  );
  if (!tokens.refreshToken) {
    throw new Error(
      "Dropbox hat keinen refresh_token geliefert (token_access_type=offline erwartet). Bitte erneut verbinden."
    );
  }

  const existing = await credentialManager.getDropboxCredentials(vaultPath);
  await credentialManager.saveDropboxCredentials(vaultPath, {
    appKey,
    refreshToken: tokens.refreshToken,
    rootPath: existing?.rootPath,
  });
}
