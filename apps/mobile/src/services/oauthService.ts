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
import { getPlatformServices, getVaultTemplates, PLAINVA_DROPBOX_APP_KEY, PLAINVA_ONEDRIVE_CLIENT_ID, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { webdavFetch } from "../adapters/webdavHttp";
import { connectProvider, createProviderVault, getStoredProvider, reauthorizeVault, type MobileSyncProvider } from "./syncService";
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

export type OAuthProviderId = "drive" | "onedrive" | "dropbox";

export interface OAuthExtras {
  clientId?: string;
  clientSecret?: string;
  rootFolderName?: string;
  rootPath?: string;
  /**
   * "New vault in the cloud" (2026-07-13): the structure template picked
   * BEFORE the browser roundtrip ("" = empty vault). Lives in the persisted
   * transaction so a cold start during consent keeps the create context;
   * absent = plain connect to an existing vault.
   */
  createTemplateId?: string;
  /**
   * Re-authorize an EXISTING vault (dead refresh token) instead of creating a
   * new one. When set, the redirect writes the fresh token into this vault's
   * slot and restarts its worker — no folder pick, no new vault.
   */
  reconnectVaultId?: string;
}

interface PendingFlow {
  provider: OAuthProviderId;
  verifier: string;
  state: string;
  extras: OAuthExtras;
  createdAt: number;
}

/**
 * Cold-start hardening (P4.4, finding M3): the flow used to live ONLY in this
 * module variable — Android killing the app during the browser consent made
 * the redirect restart Plainva with `pending === null` and the sign-in dead.
 * The transaction is now ALSO persisted in the secure store (PKCE verifier
 * included — it is a secret), restored on demand, single-use and TTL-bound.
 */
let pending: PendingFlow | null = null;
const PENDING_KEY = "oauth_pending_tx";
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Cryptographically random state (finding M3 — Math.random is guessable). */
function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function persistPending(flow: PendingFlow | null): Promise<void> {
  try {
    const creds = getPlatformServices().credentials;
    if (flow) await creds.writeSecret(PENDING_KEY, flow);
    else await creds.removeSecret(PENDING_KEY);
  } catch {
    /* the in-memory copy still serves this session */
  }
}

async function loadPending(): Promise<PendingFlow | null> {
  if (pending) return pending;
  try {
    const stored = await getPlatformServices().credentials.readSecret<PendingFlow>(PENDING_KEY);
    if (stored && typeof stored.state === "string") {
      if (Date.now() - (stored.createdAt ?? 0) < PENDING_TTL_MS) {
        pending = stored;
        return stored;
      }
      await persistPending(null); // expired transaction — never accept it
    }
  } catch {
    /* fall through: no restorable flow */
  }
  return null;
}

/**
 * Connect-time folder pick (#10): once OAuth returns a token we hold the
 * resolved provider here (folder still unset) instead of connecting straight
 * away, dispatch `plainva-oauth-choose-folder`, and let the React host browse
 * the cloud folders (listProviderFolders) with the fresh token before calling
 * finishConnect. The object is passed BY REFERENCE to the picker, so an
 * OneDrive/Dropbox refresh-token rotation during browsing stays on it.
 */
let pendingConnect: MobileSyncProvider | null = null;
/** Create-mode companion of pendingConnect (restored from the persisted flow). */
let pendingCreateTemplateId: string | null = null;

export function getPendingConnect(): MobileSyncProvider | null {
  return pendingConnect;
}

/** Bind the chosen cloud folder and create the (fresh, isolated) vault. */
export async function finishConnect(rootFolder: string): Promise<void> {
  const p = pendingConnect;
  const createTemplateId = pendingCreateTemplateId;
  pendingConnect = null;
  pendingCreateTemplateId = null;
  if (!p) return;
  const folder = rootFolder.trim() || undefined;
  let withFolder: MobileSyncProvider;
  switch (p.provider) {
    case "dropbox":
      withFolder = { provider: "dropbox", creds: { ...p.creds, rootPath: folder } };
      break;
    case "onedrive":
      withFolder = { provider: "onedrive", creds: { ...p.creds, rootFolderName: folder } };
      break;
    case "drive":
      withFolder = { provider: "drive", creds: { ...p.creds, rootFolderName: folder } };
      break;
    default:
      withFolder = p; // s3/webdav never reach the OAuth picker
  }
  if (createTemplateId === null) {
    await connectProvider(await getMobileVault(), withFolder);
    return;
  }
  // Create mode: scaffold the pre-picked template into the fresh container
  // before the vault activates; the first sync uploads it.
  const template = getVaultTemplates(i18n.language).find((d) => d.id === createTemplateId) ?? null;
  await createProviderVault(await getMobileVault(), withFolder, {
    template,
    vaultName: folder?.split("/").pop() || "Plainva",
    subfoldersHeading: i18n.t("indexMd.subfoldersHeading"),
  });
}

/** The user backed out of the folder pick — discard the token, create no vault. */
export function cancelConnect(): void {
  pendingConnect = null;
  pendingCreateTemplateId = null;
}

/**
 * Re-authorize an EXISTING vault whose OAuth token expired: run a fresh consent
 * for the vault's own provider and thread its id through the flow so the
 * redirect writes the new token into that vault's slot (no new vault, no folder
 * pick). Only OAuth providers (Drive/OneDrive/Dropbox) can be reconnected this
 * way; WebDAV/S3 use static form credentials.
 */
export async function reconnectVault(vaultId: string): Promise<void> {
  const stored = await getStoredProvider(vaultId);
  if (!stored) {
    toast.error(i18n.t("mobile.reconnectFailed", { defaultValue: "Kein Konto zum Neuanmelden gefunden." }));
    return;
  }
  if (stored.provider === "drive") {
    await beginOAuth("drive", {
      clientId: stored.creds.clientId,
      clientSecret: stored.creds.clientSecret,
      rootFolderName: stored.creds.rootFolderName,
      reconnectVaultId: vaultId,
    });
  } else if (stored.provider === "onedrive") {
    await beginOAuth("onedrive", { clientId: stored.creds.clientId, rootFolderName: stored.creds.rootFolderName, reconnectVaultId: vaultId });
  } else if (stored.provider === "dropbox") {
    await beginOAuth("dropbox", { rootPath: stored.creds.rootPath, reconnectVaultId: vaultId });
  }
}

/** Opens the provider consent page in the system browser. */
export async function beginOAuth(provider: OAuthProviderId, extras: OAuthExtras): Promise<void> {
  const pkce = await generatePkcePair();
  const state = randomState();
  pending = { provider, verifier: pkce.codeVerifier, state, extras, createdAt: Date.now() };
  await persistPending(pending);
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
  // EXACT redirect prefixes (P4.4): any app can register the same custom
  // scheme — only URLs matching one of OUR registered redirect URIs are
  // treated as OAuth at all; everything else is not our business.
  if (!urlStr.startsWith(OAUTH_REDIRECT_URI) && !urlStr.startsWith(DRIVE_REDIRECT_URI)) return false;
  const flow = await loadPending(); // module var OR secure store (cold start)
  void Browser.close().catch(() => {});
  const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
  try {
    if (!flow) throw new Error("no OAuth flow pending");
    const error = params.get("error");
    if (error) {
      // The user explicitly denied — the transaction is over.
      pending = null;
      void persistPending(null);
      throw new Error(params.get("error_description") || error);
    }
    const code = params.get("code");
    if (!code || params.get("state") !== flow.state) {
      // A forged/garbled intent must NOT burn the real pending flow — the
      // genuine redirect may still arrive. Reject this delivery only.
      throw new Error("OAuth state mismatch");
    }
    // Validated — single use: consume the transaction BEFORE the exchange.
    pending = null;
    void persistPending(null);

    let mp: MobileSyncProvider;
    if (flow.provider === "dropbox") {
      const tok = await exchangeDropboxCode(
        { appKey: PLAINVA_DROPBOX_APP_KEY, code, codeVerifier: flow.verifier, redirectUri: OAUTH_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      mp = {
        provider: "dropbox",
        creds: {
          appKey: PLAINVA_DROPBOX_APP_KEY,
          refreshToken: tok.refreshToken,
          rootPath: flow.extras.rootPath || undefined,
        },
      };
    } else if (flow.provider === "onedrive") {
      const clientId = flow.extras.clientId || PLAINVA_ONEDRIVE_CLIENT_ID;
      const tok = await exchangeOneDriveCode(
        { clientId, code, codeVerifier: flow.verifier, redirectUri: OAUTH_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      mp = {
        provider: "onedrive",
        creds: {
          clientId,
          refreshToken: tok.refreshToken,
          rootFolderName: flow.extras.rootFolderName || undefined,
        },
      };
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
      mp = {
        provider: "drive",
        creds: {
          clientId: flow.extras.clientId ?? "",
          clientSecret: flow.extras.clientSecret || undefined,
          refreshToken: tok.refreshToken,
          rootFolderName: flow.extras.rootFolderName || undefined,
        },
      };
    }
    // Reconnect an EXISTING vault (dead token): write the fresh token into its
    // slot and restart its worker — no folder pick, no new vault.
    if (flow.extras.reconnectVaultId) {
      await reauthorizeVault(flow.extras.reconnectVaultId, mp);
      toast.info(i18n.t("mobile.reconnected", { defaultValue: "Konto neu verbunden." }));
      return true;
    }
    // Two-phase folder pick (#10): don't create the vault yet — hold the fresh
    // token and let the React host browse the cloud folders, then finishConnect.
    pendingConnect = mp;
    pendingCreateTemplateId = flow.extras.createTemplateId ?? null;
    window.dispatchEvent(new CustomEvent("plainva-oauth-choose-folder"));
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
  return true;
}
