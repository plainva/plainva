import { Browser } from "@capacitor/browser";
import {
  buildAuthUrl,
  buildOneDriveAuthUrl,
  exchangeCode,
  exchangeOneDriveCode,
  generatePkcePair,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
} from "@plainva/core";
import { getPlatformServices, PLAINVA_ONEDRIVE_CLIENT_ID, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { webdavFetch } from "../../adapters/webdavHttp";
import { addPimAccount } from "./pimService";

/**
 * Mobile OAuth for Google / Microsoft CALENDAR accounts (PIM). Mirrors the sync
 * oauthService pattern — the system browser (@capacitor/browser) + PKCE + the
 * custom-scheme redirect — but requests the calendar/tasks scopes and, on
 * success, adds a PIM account (addPimAccount) instead of binding a sync folder.
 * The token refresh + storage were already prepared (pimAuth/pimCredentials);
 * this is the missing authorization step.
 *
 * Console prerequisites (one-time, maintainer):
 *  - Google: a BYO ANDROID OAuth client (package com.plainva.app + signing
 *    SHA-1), with the Calendar + Tasks APIs enabled and the calendar/tasks
 *    scopes on the consent screen. A desktop-type client id cannot work here
 *    (Google only allows loopback redirects for those).
 *  - Microsoft: the central Plainva Entra app (same as the OneDrive sync)
 *    already carries delegated Calendars/Tasks scopes — just connect + consent.
 */

// Same custom-scheme redirects as the sync oauthService (declared locally so
// this module does not pull in the sync dependencies). The Android manifest
// intent-filter matches on the scheme, so both forms land in the app. Google
// rejects the "://host" form for installed apps → the single-slash form.
const MS_REDIRECT_URI = "com.plainva.app://oauth";
const GOOGLE_REDIRECT_URI = "com.plainva.app:/oauth2redirect";

export type PimOAuthProvider = "google" | "microsoft";

interface PendingPimFlow {
  provider: PimOAuthProvider;
  verifier: string;
  state: string;
  clientId: string;
  clientSecret?: string;
  label: string;
  createdAt: number;
}

// Cold-start hardening (like the sync flow): the transaction lives in a module
// var AND the secure store, so Android killing the app during consent does not
// strand the sign-in. Single-use, TTL-bound; the PKCE verifier is a secret.
let pending: PendingPimFlow | null = null;
const PENDING_KEY = "pim_oauth_pending_tx";
const PENDING_TTL_MS = 10 * 60 * 1000;

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function persistPending(flow: PendingPimFlow | null): Promise<void> {
  try {
    const creds = getPlatformServices().credentials;
    if (flow) await creds.writeSecret(PENDING_KEY, flow);
    else await creds.removeSecret(PENDING_KEY);
  } catch {
    /* the in-memory copy still serves this session */
  }
}

async function loadPending(): Promise<PendingPimFlow | null> {
  if (pending) return pending;
  try {
    const stored = await getPlatformServices().credentials.readSecret<PendingPimFlow>(PENDING_KEY);
    if (stored && typeof stored.state === "string") {
      if (Date.now() - (stored.createdAt ?? 0) < PENDING_TTL_MS) {
        pending = stored;
        return stored;
      }
      await persistPending(null); // expired — never accept it
    }
  } catch {
    /* no restorable flow */
  }
  return null;
}

/** Opens the provider consent page for a calendar account in the system browser. */
export async function beginPimOAuth(
  provider: PimOAuthProvider,
  opts: { clientId: string; clientSecret?: string; label?: string },
): Promise<void> {
  const pkce = await generatePkcePair();
  const state = randomState();
  const clientId = provider === "microsoft" ? opts.clientId.trim() || PLAINVA_ONEDRIVE_CLIENT_ID : opts.clientId.trim();
  pending = {
    provider,
    verifier: pkce.codeVerifier,
    state,
    clientId,
    clientSecret: opts.clientSecret?.trim() || undefined,
    label: (opts.label ?? "").trim(),
    createdAt: Date.now(),
  };
  await persistPending(pending);
  const url =
    provider === "microsoft"
      ? buildOneDriveAuthUrl({ clientId, redirectUri: MS_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope: GRAPH_CALENDAR_SCOPES })
      : buildAuthUrl({ clientId, redirectUri: GOOGLE_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope: GOOGLE_CALENDAR_SCOPES });
  await Browser.open({ url });
}

/**
 * Handles an incoming app URL for a PIM OAuth flow. Returns true ONLY when it
 * consumed a PIM redirect (matching redirect prefix AND our pending state);
 * otherwise false, so the sync oauthService handler still gets its turn.
 */
export async function handlePimOAuthRedirect(urlStr: string): Promise<boolean> {
  if (!urlStr.startsWith(MS_REDIRECT_URI) && !urlStr.startsWith(GOOGLE_REDIRECT_URI)) return false;
  const flow = await loadPending();
  if (!flow) return false; // no PIM flow pending — let the sync handler try
  const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
  if (params.get("state") !== flow.state) return false; // a different (e.g. sync) redirect
  // Ours — consume the single-use transaction before any await.
  pending = null;
  void persistPending(null);
  void Browser.close().catch(() => {});
  try {
    const error = params.get("error");
    if (error) throw new Error(params.get("error_description") || error);
    const code = params.get("code");
    if (!code) throw new Error("no authorization code");
    if (flow.provider === "microsoft") {
      const tok = await exchangeOneDriveCode(
        { clientId: flow.clientId, code, codeVerifier: flow.verifier, redirectUri: MS_REDIRECT_URI, scope: GRAPH_CALENDAR_SCOPES },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      await addPimAccount("microsoft", flow.label || "Microsoft", { kind: "microsoft", clientId: flow.clientId, refreshToken: tok.refreshToken });
    } else {
      const tok = await exchangeCode(
        { clientId: flow.clientId, clientSecret: flow.clientSecret ?? "", code, codeVerifier: flow.verifier, redirectUri: GOOGLE_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      await addPimAccount("google", flow.label || "Google", { kind: "google", clientId: flow.clientId, clientSecret: flow.clientSecret ?? "", refreshToken: tok.refreshToken });
    }
    toast.success(i18n.t("pim.accountAdded", { defaultValue: "Konto verbunden" }));
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  }
  return true;
}
