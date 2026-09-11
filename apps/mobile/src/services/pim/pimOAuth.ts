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
import { getPlatformServices, PLAINVA_ONEDRIVE_CLIENT_ID, serviceConnectionMessage, toast, withAccountCredentialLock } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { webdavFetch } from "../../adapters/webdavHttp";
import { addPimAccount, reauthorizePimAccount } from "./pimService";
import type { PimStoredCredentials } from "./pimCredentials";
import type { CloudAccountRecord, CloudServiceId, StoredAccountToken } from "@plainva/ui";
import type { ServiceConnectionContext } from "@plainva/ui";
import { getActiveVaultEntry } from "../vaultRegistry";
import { connectionContextFor, loadConnectQueue, outcomeBelongsToRun, recordConnectOutcome } from "../connectQueue";
import { getMobileVault, switchVault } from "../vaultService";

/** Stored beside the PKCE verifier, never inferred from the current screen. */
export interface AccountOAuthContext {
  vaultId: string;
  record: CloudAccountRecord;
  expectedToken: StoredAccountToken | null;
  serviceSources: Partial<Record<CloudServiceId, string>>;
}

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

/**
 * What the consent is for (feinplan G0.2). Calendar has always been the only
 * purpose; mail reuses this exact flow with different scopes, and the pending
 * transaction carries the purpose so the single redirect handler knows where
 * to hand the token — instead of a second, near-identical handler competing
 * for the same custom-scheme redirect.
 */
/**
 * `account` is the union consent (cloud accounts stage B): ONE sign-in for
 * every service a Google/Microsoft account carries, whose token lands in the
 * account slot instead of one copy per service. The desktop has offered it
 * since stage B; the phone only ever signed in per service (Sammelplan C5).
 */
export type PimOAuthPurpose = "calendar" | "mail" | "account";

/** Resolves the token result of a completed flow; mail registers its own. */
export type OAuthPurposeHandler = (result: {
  provider: PimOAuthProvider;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken?: string;
  label: string;
  /**
   * The scope the provider GRANTED, when it reported one. Absent means the
   * grant is unknown — and unknown must read as "covers nothing", never as
   * "covers what we asked for".
   */
  grantedScope?: string;
  requestedScope?: string;
  accountContext?: AccountOAuthContext;
  serviceContext?: ServiceConnectionContext;
}) => Promise<void>;

const purposeHandlers = new Map<string, OAuthPurposeHandler>();

/** Registered by the mail runtime at startup (calendar stays built in). */
export function setOAuthPurposeHandler(purpose: PimOAuthPurpose, handler: OAuthPurposeHandler): void {
  purposeHandlers.set(purpose, handler);
}

interface PendingPimFlow {
  provider: PimOAuthProvider;
  /** Absent in transactions written before G0.2 — those are calendar flows. */
  purpose?: PimOAuthPurpose;
  /** Scope string of the flow, so the token exchange matches the consent. */
  scope?: string;
  verifier: string;
  state: string;
  clientId: string;
  clientSecret?: string;
  label: string;
  /**
   * Set when this consent RE-signs an existing account (findings P6.1): the
   * result replaces that account's credential instead of adding a second row.
   * Absent in every transaction written before P6.1 — those add, as they always
   * did, so a flow that survives the update lands where it was headed.
   */
  accountId?: string;
  accountContext?: AccountOAuthContext;
  serviceContext?: ServiceConnectionContext;
  createdAt: number;
}

// Cold-start hardening (like the sync flow): the transaction lives in a module
// var AND the secure store, so Android killing the app during consent does not
// strand the sign-in. Single-use, TTL-bound; the PKCE verifier is a secret.
let pending: PendingPimFlow | null = null;
const PENDING_KEY = "pim_oauth_pending_tx";
const RESULT_KEY = "pim_oauth_received";
interface ReceivedPimFlow { flow: PendingPimFlow; refreshToken: string; accessToken: string; grantedScope?: string }
let applyingResult = false;

export async function hasReceivedPimOAuthResult(context: ServiceConnectionContext, service: CloudServiceId): Promise<boolean> {
  const saved = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
  return !!saved && (saved.flow.purpose ?? "calendar") === service && saved.flow.serviceContext?.runId === context.runId && saved.flow.serviceContext?.vaultId === context.vaultId;
}

/** Replays a received grant after a storage error or process restart. */
export async function resumePimOAuthResult(): Promise<void> {
  if (applyingResult) return;
  applyingResult = true;
  let saved: ReceivedPimFlow | null = null;
  try {
    saved = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
    if (!saved) return;
    const { flow, refreshToken, accessToken, grantedScope } = saved;
    const purpose = flow.purpose ?? "calendar";
    const context = flow.serviceContext;
    if (Date.now() - flow.createdAt < 0 || Date.now() - flow.createdAt >= PENDING_TTL_MS) {
      await getPlatformServices().credentials.removeSecret(RESULT_KEY);
      await recordConnectOutcome(context, purpose === "mail" ? "mail" : "calendar", { state: "needsConsent" });
      return;
    }
    if (context?.runId) {
      const run = await loadConnectQueue();
      if (!run || !outcomeBelongsToRun(run, context, purpose === "mail" ? "mail" : "calendar")) {
        await getPlatformServices().credentials.removeSecret(RESULT_KEY);
        return;
      }
    }
    if (context && (await getActiveVaultEntry()).id !== context.vaultId) {
      await switchVault(context.vaultId);
      if (purpose === "calendar") { const { startPim } = await import("./pimService"); await startPim(await getMobileVault()); }
    }
    const handler = purposeHandlers.get(purpose);
    if (purpose === "account" && !handler) throw new Error("Account sign-in handler is not ready");
    if (handler) {
      await handler({ provider: flow.provider, clientId: flow.clientId, clientSecret: flow.clientSecret, refreshToken, accessToken, label: flow.label, grantedScope, requestedScope: flow.scope, accountContext: flow.accountContext, serviceContext: context });
    } else {
      const creds: PimStoredCredentials = flow.provider === "microsoft"
        ? { kind: "microsoft", clientId: flow.clientId, refreshToken }
        : { kind: "google", clientId: flow.clientId, clientSecret: flow.clientSecret ?? "", refreshToken };
      if (flow.accountId) {
        await reauthorizePimAccount(flow.accountId, creds, context);
        await recordConnectOutcome(context, "calendar", { state: "alreadyConnected", bindingId: flow.accountId });
      } else await addPimAccount(creds.kind, flow.label || (flow.provider === "microsoft" ? "Microsoft" : "Google"), creds, context);
    }
    const current = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
    if (current?.flow.state === flow.state) await getPlatformServices().credentials.removeSecret(RESULT_KEY);
    if (purpose !== "account") toast.success(i18n.t("pim.accountAdded"));
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
  } catch (error) {
    if (saved) {
      const message = error instanceof Error ? error.message : String(error);
      const needsConsent = /wrongAccount|needsConsent|invalid_grant|accountChanged/.test(message);
      if (needsConsent) {
        const current = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
        if (current?.flow.state === saved.flow.state) await getPlatformServices().credentials.removeSecret(RESULT_KEY);
      }
      await recordConnectOutcome(saved.flow.serviceContext, saved.flow.purpose === "mail" ? "mail" : "calendar", { state: needsConsent ? "needsConsent" : "failed", message }).catch(() => {});
    }
    throw error;
  } finally { applyingResult = false; }
}
const PENDING_TTL_MS = 10 * 60 * 1000;

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function persistPending(flow: PendingPimFlow | null): Promise<void> {
  try {
    await withAccountCredentialLock(PENDING_KEY, async () => {
      const creds = getPlatformServices().credentials;
      if (flow) await creds.writeSecret(PENDING_KEY, flow);
      else await creds.removeSecret(PENDING_KEY);
    });
  } catch {
    /* the in-memory copy still serves this session */
  }
}

async function loadPending(): Promise<PendingPimFlow | null> {
  if (pending && Date.now() - pending.createdAt >= 0 && Date.now() - pending.createdAt < PENDING_TTL_MS) return pending;
  pending = null;
  try {
    const stored = await getPlatformServices().credentials.readSecret<PendingPimFlow>(PENDING_KEY);
    if (stored && typeof stored.state === "string") {
      if (Date.now() - stored.createdAt >= 0 && Date.now() - stored.createdAt < PENDING_TTL_MS) {
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
  opts: { clientId: string; clientSecret?: string; label?: string; purpose?: PimOAuthPurpose; scope?: string; accountId?: string; accountContext?: AccountOAuthContext; serviceContext?: ServiceConnectionContext },
): Promise<void> {
  const pkce = await generatePkcePair();
  const state = randomState();
  const clientId = provider === "microsoft" ? opts.clientId.trim() || PLAINVA_ONEDRIVE_CLIENT_ID : opts.clientId.trim();
  const purpose = opts.purpose ?? "calendar";
  const serviceContext = purpose === "account" ? undefined : opts.serviceContext ?? await connectionContextFor(purpose) ?? { vaultId: (await getActiveVaultEntry()).id };
  const scope = opts.scope ?? (provider === "microsoft" ? GRAPH_CALENDAR_SCOPES : GOOGLE_CALENDAR_SCOPES);
  pending = {
    provider,
    purpose,
    scope,
    verifier: pkce.codeVerifier,
    state,
    clientId,
    clientSecret: opts.clientSecret?.trim() || undefined,
    label: (opts.label ?? "").trim(),
    accountId: opts.accountId,
    accountContext: opts.accountContext ? structuredClone(opts.accountContext) : undefined,
    serviceContext,
    createdAt: Date.now(),
  };
  // An account reconnect must restore its target after a cold start. Do not
  // open a consent whose durable context could not be stored.
  {
    if (purpose === "account" && !pending.accountContext) { pending = null; throw new Error("Missing account sign-in context"); }
    const flow = pending;
    try { await withAccountCredentialLock(PENDING_KEY, async () => {
      const creds = getPlatformServices().credentials;
      await creds.writeSecret(PENDING_KEY, flow);
      if (JSON.stringify(await creds.readSecret(PENDING_KEY)) !== JSON.stringify(flow)) throw new Error("Account sign-in context could not be confirmed in secure storage");
    }); }
    catch (error) { pending = null; throw error; }
  }
  const url =
    provider === "microsoft"
      ? buildOneDriveAuthUrl({ clientId, redirectUri: MS_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope })
      : buildAuthUrl({ clientId, redirectUri: GOOGLE_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope });
  await Browser.open({ url });
}

/**
 * Handles an incoming app URL for a PIM OAuth flow. Returns true ONLY when it
 * consumed a PIM redirect (matching redirect prefix AND our pending state);
 * otherwise false, so the sync oauthService handler still gets its turn.
 */
export async function handlePimOAuthRedirect(urlStr: string): Promise<boolean> {
  const base = urlStr.split(/[?#]/)[0];
  if (base !== MS_REDIRECT_URI && base !== GOOGLE_REDIRECT_URI) return false;
  const flow = await loadPending();
  if (!flow) return false; // no PIM flow pending — let the sync handler try
  const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
  if (params.get("state") !== flow.state) return false; // a different (e.g. sync) redirect
  // Ours — consume the single-use transaction before any await.
  pending = null;
  void Browser.close().catch(() => {});
  try {
    const claimed = await withAccountCredentialLock(PENDING_KEY, async () => {
      const creds = getPlatformServices().credentials;
      const stored = await creds.readSecret<PendingPimFlow>(PENDING_KEY);
      if (stored?.state !== flow.state) return false;
      await creds.removeSecret(PENDING_KEY);
      return true;
    });
    if (!claimed) return true;
    const error = params.get("error");
    if (error === "access_denied") {
      await recordConnectOutcome(flow.serviceContext, flow.purpose === "mail" ? "mail" : "calendar", { state: "cancelled" });
      return true;
    }
    if (error) throw new Error(error);
    const code = params.get("code");
    if (!code) throw new Error("no authorization code");
    let refreshToken: string;
    let accessToken: string;
    // What the provider GRANTED. Google ignores a requested scope on refresh,
    // so the grant is the only thing that says what this token can ever do —
    // recording the request instead let a Drive-only token claim the calendar
    // (finding 2026-08-19).
    let grantedScope: string | undefined;
    if (flow.provider === "microsoft") {
      const tok = await exchangeOneDriveCode(
        { clientId: flow.clientId, code, codeVerifier: flow.verifier, redirectUri: MS_REDIRECT_URI, scope: flow.scope ?? GRAPH_CALENDAR_SCOPES },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      refreshToken = tok.refreshToken;
      accessToken = tok.accessToken;
      grantedScope = tok.scope;
    } else {
      const tok = await exchangeCode(
        { clientId: flow.clientId, clientSecret: flow.clientSecret ?? "", code, codeVerifier: flow.verifier, redirectUri: GOOGLE_REDIRECT_URI },
        webdavFetch,
      );
      if (!tok.refreshToken) throw new Error("provider returned no refresh token");
      refreshToken = tok.refreshToken;
      accessToken = tok.accessToken;
      grantedScope = tok.scope;
    }
    const received: ReceivedPimFlow = { flow, refreshToken, accessToken, grantedScope };
    await getPlatformServices().credentials.writeSecret(RESULT_KEY, received);
    if (JSON.stringify(await getPlatformServices().credentials.readSecret(RESULT_KEY)) !== JSON.stringify(received)) throw new Error("storageFailed");
    await resumePimOAuthResult();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordConnectOutcome(flow.serviceContext, flow.purpose === "mail" ? "mail" : "calendar", { state: /wrongAccount|needsConsent|invalid_grant|accountChanged/.test(message) ? "needsConsent" : "failed", message }).catch(() => {});
    toast.error(serviceConnectionMessage(e, i18n.t));
  }
  return true;
}
