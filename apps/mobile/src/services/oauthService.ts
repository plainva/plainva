import { Browser } from "@capacitor/browser";
import {
  buildAuthUrl,
  buildDropboxAuthUrl,
  buildOneDriveAuthUrl,
  exchangeCode,
  exchangeDropboxCode,
  exchangeOneDriveCode,
  generatePkcePair,
} from "@plainva/core";
import { PLAINVA_DROPBOX_APP_KEY, PLAINVA_ONEDRIVE_CLIENT_ID, toast } from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";
import { connectProvider } from "./syncService";
import { getMobileVault } from "./vaultService";

/**
 * Mobile OAuth (M3): the system browser (@capacitor/browser) replaces the
 * desktop loopback server. The provider redirects to the custom scheme
 * below (AndroidManifest intent-filter → appUrlOpen), the code is
 * exchanged via the shared core helpers over the native OkHttp fetch
 * (CORS-free), and the resulting provider lands in the sync slot.
 *
 * Console prerequisites (maintainer, one-time):
 *  - Dropbox app: add redirect URI  com.plainva.app://oauth
 *  - Entra (OneDrive): platform "Mobile and desktop applications", add
 *    redirect URI  com.plainva.app://oauth
 *  - Google Drive stays BYO: create an ANDROID OAuth client (package
 *    com.plainva.app + signing SHA-1); Android clients have no secret.
 *    A desktop-type client id cannot work here (it only allows loopback
 *    redirects — Google answers "invalid_request").
 */

export const OAUTH_REDIRECT_URI = "com.plainva.app://oauth";
/**
 * Google rejects the "://host" form for installed-app custom schemes
 * (error 400 invalid_request, seen live on the Pixel). Android clients
 * expect the documented single-slash form "<scheme>:/<path>". The
 * manifest intent-filter matches on the scheme alone, so both URIs land
 * in the app.
 */
export const DRIVE_REDIRECT_URI = "com.plainva.app:/oauth2redirect";
/** Every redirect we can receive starts with our scheme. */
const REDIRECT_SCHEME_PREFIX = "com.plainva.app:";

export type OAuthProviderId = "drive" | "onedrive" | "dropbox";

export interface OAuthExtras {
  clientId?: string;
  clientSecret?: string;
  rootFolderName?: string;
  rootPath?: string;
}

let pending: {
  provider: OAuthProviderId;
  verifier: string;
  state: string;
  extras: OAuthExtras;
} | null = null;

/** Opens the provider consent page in the system browser. */
export async function beginOAuth(provider: OAuthProviderId, extras: OAuthExtras): Promise<void> {
  const pkce = await generatePkcePair();
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pending = { provider, verifier: pkce.codeVerifier, state, extras };
  const url =
    provider === "dropbox"
      ? buildDropboxAuthUrl({
          appKey: PLAINVA_DROPBOX_APP_KEY,
          redirectUri: OAUTH_REDIRECT_URI,
          codeChallenge: pkce.codeChallenge,
          state,
        })
      : provider === "onedrive"
        ? buildOneDriveAuthUrl({
            clientId: extras.clientId || PLAINVA_ONEDRIVE_CLIENT_ID,
            redirectUri: OAUTH_REDIRECT_URI,
            codeChallenge: pkce.codeChallenge,
            state,
          })
        : buildAuthUrl({
            clientId: extras.clientId ?? "",
            redirectUri: DRIVE_REDIRECT_URI,
            codeChallenge: pkce.codeChallenge,
            state,
          });
  await Browser.open({ url });
}

/** Handles an incoming app URL; returns true when it was an OAuth redirect. */
export async function handleOAuthRedirect(urlStr: string): Promise<boolean> {
  if (!urlStr.startsWith(REDIRECT_SCHEME_PREFIX)) return false;
  const flow = pending;
  pending = null;
  void Browser.close().catch(() => {});
  const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
  try {
    if (!flow) throw new Error("no OAuth flow pending");
    const error = params.get("error");
    if (error) throw new Error(params.get("error_description") || error);
    const code = params.get("code");
    if (!code || params.get("state") !== flow.state) throw new Error("OAuth state mismatch");

    const v = await getMobileVault();
    if (flow.provider === "dropbox") {
      const tok = await exchangeDropboxCode(
        { appKey: PLAINVA_DROPBOX_APP_KEY, code, codeVerifier: flow.verifier, redirectUri: OAUTH_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      await connectProvider(v, {
        provider: "dropbox",
        creds: {
          appKey: PLAINVA_DROPBOX_APP_KEY,
          refreshToken: tok.refreshToken,
          rootPath: flow.extras.rootPath || undefined,
        },
      });
    } else if (flow.provider === "onedrive") {
      const clientId = flow.extras.clientId || PLAINVA_ONEDRIVE_CLIENT_ID;
      const tok = await exchangeOneDriveCode(
        { clientId, code, codeVerifier: flow.verifier, redirectUri: OAUTH_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      await connectProvider(v, {
        provider: "onedrive",
        creds: {
          clientId,
          refreshToken: tok.refreshToken,
          rootFolderName: flow.extras.rootFolderName || undefined,
        },
      });
    } else {
      const tok = await exchangeCode(
        {
          clientId: flow.extras.clientId ?? "",
          // Android OAuth clients have no secret; the token endpoint accepts
          // an empty client_secret for them.
          clientSecret: flow.extras.clientSecret ?? "",
          code,
          codeVerifier: flow.verifier,
          redirectUri: DRIVE_REDIRECT_URI,
        },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      await connectProvider(v, {
        provider: "drive",
        creds: {
          clientId: flow.extras.clientId ?? "",
          clientSecret: flow.extras.clientSecret || undefined,
          refreshToken: tok.refreshToken,
          rootFolderName: flow.extras.rootFolderName || undefined,
        },
      });
    }
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
  return true;
}
