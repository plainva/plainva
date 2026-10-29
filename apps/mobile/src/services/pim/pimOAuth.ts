import { sameStoredValue } from "@plainva/core";
import { Browser } from "@capacitor/browser";
import { authorizeNativeGoogle, googleSignInFlow, hasGooglePlayServices } from "../googleNativeAuthorization";
import { wasSignInAnnounced } from "../signInNotice";
import {
  buildAuthUrl,
  buildOneDriveAuthUrl,
  exchangeCode,
  exchangeOneDriveCode,
  generatePkcePair,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
} from "@plainva/core";
import { getPlatformServices, logDiagnostic, PLAINVA_ONEDRIVE_CLIENT_ID, ServiceConnectionError, toast, withAccountCredentialLock } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { webdavFetch } from "../../adapters/webdavHttp";
import { addPimAccount, reauthorizePimAccount } from "./pimService";
import { getPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import type { CloudAccountRecord, CloudServiceId, PreparedSignIn, StoredAccountToken } from "@plainva/ui";
import type { ServiceConnectionContext } from "@plainva/ui";
import { getActiveVaultEntry } from "../vaultRegistry";
import { connectionContextFor, loadConnectQueue, outcomeBelongsToRun, recordConnectOutcome } from "../connectQueue";
import { getMobileVault } from "../vaultService";
import { enterFlowVault, releaseFlowVault, waitsAtOffer } from "../flowVault";
import { APP_ID, APP_URL, redirectAddress } from "../appScheme";
import { openSignInPage } from "../../platform/webAuth";
import { connectionFailureToast } from "../connectionToast";

/** Stored beside the PKCE verifier, never inferred from the current screen. */
export interface AccountOAuthContext {
  vaultId: string;
  record: CloudAccountRecord;
  expectedToken: StoredAccountToken | null;
  serviceSources: Partial<Record<CloudServiceId, string>>;
}

/**
 * Mobile OAuth for calendar, mail and combined account grants. Google and
 * Microsoft sign in through the system browser with PKCE, on both phones.
 * Android additionally has Play services' AuthorizationClient, used only where
 * it can work (`chooseGoogleSignInFlow`): with the client this build ships, and
 * to renew an account that already holds a Play-services grant. Both paths
 * persist the originating account and vault until the service handler has
 * durably acknowledged the granted credentials.
 *
 * Console prerequisites:
 *  - Google, a user's own project (both phones): an OAuth client of type iOS
 *    whose bundle ID is the app id — its custom-scheme return is the redirect
 *    below. An Android-type client is NOT an option for a user: Google lets
 *    the package name + signing fingerprint of the Play build be registered in
 *    exactly one project. See docs/engineering/Google_Mail.md.
 *  - Microsoft: the central Plainva Entra app (same as the OneDrive sync)
 *    already carries delegated Calendars/Tasks scopes — just connect + consent.
 */

// Browser redirects. The Android manifest's intent filter and the iOS URL type
// both answer on the app id as a scheme; a Play-services consent returns
// through the activity result instead and uses neither.
const MS_REDIRECT_URI = `${APP_URL}oauth`;
const GOOGLE_REDIRECT_URI = `${APP_ID}:/oauth2redirect`;

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
/**
 * `signin` is the one account sign-in (account sign-in plan K4): connecting an
 * account, adding a service and signing in again, carried through the browser
 * and a cold start as a prepared request (`PreparedSignIn`).
 */
export type PimOAuthPurpose = "calendar" | "mail" | "gmail" | "account" | "signin";

/** Resolves the token result of a completed flow; mail registers its own. */
export type OAuthPurposeHandler = (result: {
  provider: PimOAuthProvider;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  nativeGoogle?: StoredAccountToken["nativeGoogle"];
  providerIdentity?: StoredAccountToken["providerIdentity"];
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
  signIn?: PreparedSignIn;
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
  signIn?: PreparedSignIn;
  createdAt: number;
}

// Cold-start hardening (like the sync flow): the transaction lives in a module
// var AND the secure store, so Android killing the app during consent does not
// strand the sign-in. Single-use, TTL-bound; the PKCE verifier is a secret.
let pending: PendingPimFlow | null = null;
const PENDING_KEY = "pim_oauth_pending_tx";
const RESULT_KEY = "pim_oauth_received";
interface ReceivedPimFlow { flow: PendingPimFlow; refreshToken: string; accessToken: string; grantedScope?: string; nativeGoogle?: StoredAccountToken["nativeGoogle"]; providerIdentity?: StoredAccountToken["providerIdentity"] }
let applyingResult = false;

export async function hasReceivedPimOAuthResult(context: ServiceConnectionContext, service: CloudServiceId): Promise<boolean> {
  const saved = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
  return !!saved && (saved.flow.purpose === "gmail" ? "mail" : saved.flow.purpose ?? "calendar") === service && saved.flow.serviceContext?.runId === context.runId && saved.flow.serviceContext?.vaultId === context.vaultId;
}

/** A received grant is accepted for this long after its consent was begun. */
const receivedInTime = (flow: PendingPimFlow) => Date.now() - flow.createdAt >= 0 && Date.now() - flow.createdAt < PENDING_TTL_MS;
/** One received grant waits at a time (`RESULT_KEY` is one slot), so one sign-in can wait for its vault. */
const SIGN_IN_FLOW = "sign-in";

/** Replays a received grant after a storage error or process restart. */
export function resumePimOAuthResult(): Promise<void> {
  return applyReceived();
}

/**
 * `offered` names the grant whose vault was offered instead of taken
 * (`flowVault.ts`) and has now become the active one: this call is that grant
 * going on, and it is for no other.
 */
async function applyReceived(offered?: string): Promise<void> {
  if (applyingResult) return;
  applyingResult = true;
  let saved: ReceivedPimFlow | null = null;
  try {
    saved = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
    if (!saved) return;
    const { flow, refreshToken, accessToken, grantedScope, nativeGoogle, providerIdentity } = saved;
    const purpose = flow.purpose ?? "calendar";
    const context = flow.serviceContext;
    const waited = offered !== undefined && flow.state === offered;
    // A later sign-in has taken this one's place meanwhile; it goes its own way.
    if (offered !== undefined && !waited) return;
    // The ten minutes bound a replay after a storage error or a restart. A
    // grant that was held back for the sake of the person's own screen has not
    // been waiting on anything of ours: it holds until its vault is open or a
    // later sign-in takes its place — also through a replay while it waits.
    const heldBack = waited || (!!context && waitsAtOffer(context.vaultId, SIGN_IN_FLOW));
    if (!heldBack && !receivedInTime(flow)) {
      await getPlatformServices().credentials.removeSecret(RESULT_KEY);
      releaseFlowVault(SIGN_IN_FLOW);
      await recordConnectOutcome(context, (purpose === "mail" || purpose === "gmail") ? "mail" : "calendar", { state: "needsConsent" });
      return;
    }
    if (context?.runId) {
      const run = await loadConnectQueue();
      if (!run || !outcomeBelongsToRun(run, context, (purpose === "mail" || purpose === "gmail") ? "mail" : "calendar")) {
        await getPlatformServices().credentials.removeSecret(RESULT_KEY);
        releaseFlowVault(SIGN_IN_FLOW);
        return;
      }
    }
    if (context) {
      // The sign-in belongs to the vault it was begun in. With another one on
      // screen by now it goes back there — offered rather than taken while
      // something unsaved is on screen there (`flowVault.ts`). The grant stays
      // where it is, in protected storage, until its vault is the active one.
      const here = (await getActiveVaultEntry()).id === context.vaultId;
      const state = flow.state;
      if (!here && !(await enterFlowVault(context.vaultId, SIGN_IN_FLOW, {
        resume: () => applyReceived(state),
        waits: async () => (await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY))?.flow.state === state,
        // Its vault was deleted: the grant has nowhere to go.
        gone: async () => {
          const credentials = getPlatformServices().credentials;
          if ((await credentials.readSecret<ReceivedPimFlow>(RESULT_KEY))?.flow.state === state) await credentials.removeSecret(RESULT_KEY);
        },
      }))) return;
      // The vault was just made the active one for this grant, here or on its
      // offer: its calendar runtime is started rather than waited for.
      if ((waited || !here) && purpose === "calendar") { const { startPim } = await import("./pimService"); await startPim(await getMobileVault()); }
    }
    const handler = purposeHandlers.get(purpose);
    if ((purpose === "account" || purpose === "gmail" || purpose === "signin") && !handler) throw new Error("Account sign-in handler is not ready");
    if (handler) {
      await handler({ provider: flow.provider, clientId: flow.clientId, clientSecret: nativeGoogle ? undefined : flow.clientSecret, refreshToken, accessToken, label: flow.label, grantedScope, requestedScope: flow.scope, accountContext: flow.accountContext, serviceContext: context, ...(flow.signIn ? { signIn: flow.signIn } : {}), ...(nativeGoogle ? { nativeGoogle, providerIdentity } : {}) });
    } else {
      const creds: PimStoredCredentials = flow.provider === "microsoft"
        ? { kind: "microsoft", clientId: flow.clientId, refreshToken }
        : { kind: "google", clientId: flow.clientId, clientSecret: nativeGoogle ? "" : flow.clientSecret ?? "", refreshToken, grantedScope, ...(nativeGoogle ? { nativeGoogle, providerIdentity } : {}) };
      if (flow.accountId) {
        await reauthorizePimAccount(flow.accountId, creds, context);
        await recordConnectOutcome(context, "calendar", { state: "alreadyConnected", bindingId: flow.accountId });
      } else await addPimAccount(creds.kind, flow.label || (flow.provider === "microsoft" ? "Microsoft" : "Google"), creds, context);
    }
    const current = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
    if (current?.flow.state === flow.state) await getPlatformServices().credentials.removeSecret(RESULT_KEY);
    if (purpose !== "account" && purpose !== "signin") toast.success(i18n.t("pim.accountAdded"));
    window.dispatchEvent(new CustomEvent("m-pim-changed"));
  } catch (error) {
    if (saved) {
      const message = error instanceof Error ? error.message : String(error);
      const needsConsent = /wrongAccount|needsConsent|invalid_grant|accountChanged/.test(message);
      if (needsConsent) {
        const current = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
        if (current?.flow.state === saved.flow.state) await getPlatformServices().credentials.removeSecret(RESULT_KEY);
      }
      await recordConnectOutcome(saved.flow.serviceContext, (saved.flow.purpose === "mail" || saved.flow.purpose === "gmail") ? "mail" : "calendar", { state: needsConsent ? "needsConsent" : "failed", message }).catch(() => {});
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

type PimOAuthOptions = { clientId: string; clientSecret?: string; label?: string; purpose?: PimOAuthPurpose; scope?: string; accountId?: string; accountContext?: AccountOAuthContext; serviceContext?: ServiceConnectionContext; signIn?: PreparedSignIn };

/** The vault a sign-in belongs to: the account flows carry their own. */
async function contextOf(opts: PimOAuthOptions, purpose: PimOAuthPurpose): Promise<ServiceConnectionContext | undefined> {
  if (purpose === "account") return undefined;
  if (purpose === "signin") return { vaultId: opts.signIn!.intent.vaultId };
  return opts.serviceContext ?? await connectionContextFor(purpose === "gmail" ? "mail" : purpose) ?? { vaultId: (await getActiveVaultEntry()).id };
}

/** Native Google consent and its durable completion form one operation, shared
 * with Drive, so another screen cannot replace an unacknowledged result. */
export async function beginPimOAuth(provider: PimOAuthProvider, opts: PimOAuthOptions): Promise<void> {
  // The one sign-in knows its flow from this device's access: the system sheet
  // only with Plainva's own client on Android (oauthAccess.ts).
  const native = opts.signIn ? opts.signIn.intent.access.flow === "system" : await signsInThroughPlayServices(opts);
  if (provider === "google" && native) {
    const purpose = opts.purpose ?? "calendar";
    const context = await contextOf(opts, purpose);
    const captured = structuredClone({ ...opts, serviceContext: context });
    return withAccountCredentialLock("native-google-consent", async () => {
      const saved = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
      if (saved) {
        await resumePimOAuthResult();
        if (Date.now() - saved.flow.createdAt >= 0 && Date.now() - saved.flow.createdAt < PENDING_TTL_MS
          && saved.flow.provider === provider && saved.flow.purpose === purpose && saved.flow.clientId === captured.clientId
          && saved.flow.scope === (captured.scope ?? GOOGLE_CALENDAR_SCOPES)
          && saved.flow.accountId === captured.accountId
          && saved.flow.serviceContext?.vaultId === captured.serviceContext?.vaultId
          && saved.flow.serviceContext?.runId === captured.serviceContext?.runId
          && saved.flow.serviceContext?.cloudAccountId === captured.serviceContext?.cloudAccountId
          && saved.flow.accountContext?.record.id === captured.accountContext?.record.id) return;
      }
      return beginPimOAuthFlow(provider, captured, true);
    });
  }
  return beginPimOAuthFlow(provider, opts, false);
}

/** The client ID of a stored Google grant, when Play services holds it. */
function nativeGrantClientId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const grant = value as { clientId?: unknown; nativeGoogle?: { email?: unknown } | null; creds?: unknown; grants?: unknown };
  if (grant.nativeGoogle?.email && typeof grant.clientId === "string") return grant.clientId;
  // A file-sync provider keeps its grant under `creds`, an account slot under `grants`.
  if (Array.isArray(grant.grants)) return grant.grants.map(nativeGrantClientId).find((id) => !!id) ?? null;
  return grant.creds ? nativeGrantClientId(grant.creds) : null;
}

/**
 * Whether this Google sign-in goes through Play services (Android) or through
 * the browser — the rule is `chooseGoogleSignInFlow`; this collects what it
 * needs to know: which Play-services grants the sign-in would replace.
 *
 * A NEW connection has none, so a client ID the user entered opens the
 * browser. Signing an account in again that already works through Play
 * services stays there, as long as it is asked for with the same client.
 */
async function signsInThroughPlayServices(opts: PimOAuthOptions): Promise<boolean> {
  if (!hasGooglePlayServices()) return false;
  const held: (string | null)[] = [nativeGrantClientId(opts.accountContext?.expectedToken)];
  for (const source of Object.values(opts.accountContext?.serviceSources ?? {})) {
    try { held.push(nativeGrantClientId(JSON.parse(source ?? "null"))); } catch { /* not a stored grant */ }
  }
  if (opts.accountId && (opts.purpose ?? "calendar") === "calendar") {
    const vaultId = opts.serviceContext?.vaultId ?? (await getActiveVaultEntry()).id;
    held.push(nativeGrantClientId(await getPimCredentials(vaultId, opts.accountId).catch(() => null)));
  }
  return googleSignInFlow(opts.clientId, held) === "native";
}

async function beginPimOAuthFlow(
  provider: PimOAuthProvider,
  opts: PimOAuthOptions,
  playServices: boolean,
): Promise<void> {
  const pkce = await generatePkcePair();
  const state = randomState();
  const clientId = provider === "microsoft" ? opts.clientId.trim() || PLAINVA_ONEDRIVE_CLIENT_ID : opts.clientId.trim();
  const purpose = opts.purpose ?? "calendar";
  const serviceContext = await contextOf(opts, purpose);
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
    ...(opts.signIn ? { signIn: structuredClone(opts.signIn) } : {}),
    createdAt: Date.now(),
  };
  // An account reconnect must restore its target after a cold start. Do not
  // open a consent whose durable context could not be stored.
  {
    if (purpose === "account" && !pending.accountContext) { pending = null; throw new Error("Missing account sign-in context"); }
    if (purpose === "signin" && !pending.signIn) { pending = null; throw new Error("Missing account sign-in context"); }
    const flow = pending;
    try { await withAccountCredentialLock(PENDING_KEY, async () => {
      const creds = getPlatformServices().credentials;
      await creds.writeSecret(PENDING_KEY, flow);
      if (!sameStoredValue(await creds.readSecret(PENDING_KEY), flow)) throw new Error("Account sign-in context could not be confirmed in secure storage");
    }); }
    catch (error) { pending = null; throw error; }
  }
  if (provider === "google" && playServices) {
    const flow = pending;
    try {
      // A grant that waits at its vault's offer is not in flight: like a sign-in
      // through the browser, this one takes its place (`flowVault.ts`).
      const held = await getPlatformServices().credentials.readSecret<ReceivedPimFlow>(RESULT_KEY);
      if (held && !(held.flow.serviceContext && waitsAtOffer(held.flow.serviceContext.vaultId, SIGN_IN_FLOW))) throw new Error("storageFailed: a previous sign-in must finish first");
      const result = await authorizeNativeGoogle(scope, true, opts.accountContext?.expectedToken ?? undefined);
      const received: ReceivedPimFlow = { flow, refreshToken: "", accessToken: result.accessToken, grantedScope: result.scope,
        nativeGoogle: { email: result.profile.label! }, providerIdentity: result.profile.identity };
      const credentials = getPlatformServices().credentials;
      await credentials.writeSecret(RESULT_KEY, received);
      if (!sameStoredValue(await credentials.readSecret(RESULT_KEY), received)) throw new Error("Google sign-in could not be confirmed in secure storage");
      releaseFlowVault(SIGN_IN_FLOW);
      pending = null;
      await persistPending(null);
      await resumePimOAuthResult();
      return;
    } catch (error) {
      pending = null;
      await persistPending(null);
      // The run keeps WHY (a marker or the provider's words, never a token):
      // a screen that is opened again must show the same, true sentence the
      // attempt itself showed, not "could not be completed".
      const cancelled = (error as { code?: string })?.code === "CANCELLED";
      await recordConnectOutcome(serviceContext, purpose === "gmail" || purpose === "mail" ? "mail" : "calendar",
        cancelled ? { state: "cancelled" } : { state: "failed", message: error instanceof Error ? error.message : String(error) }).catch(() => {});
      throw error;
    }
  }
  const url =
    provider === "microsoft"
      ? buildOneDriveAuthUrl({ clientId, redirectUri: MS_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope, loginHint: opts.signIn?.loginHint })
      : buildAuthUrl({ clientId, redirectUri: GOOGLE_REDIRECT_URI, codeChallenge: pkce.codeChallenge, state, scope, loginHint: opts.signIn?.loginHint });
  logDiagnostic("sign-in", `${provider} (${purpose}): browser opened`);
  watchBrowserClosed(provider, state);
  await openSignInPage(url);
}

/**
 * The browser closed and no answer came: the provider never sent the person
 * back to the app (device finding 2026-10-28, Android: back on the services
 * screen, nothing in the diagnostics). Said in the diagnostics, so the next
 * export tells a missing answer from a refused one.
 */
function watchBrowserClosed(provider: PimOAuthProvider, state: string): void {
  let listener: { remove: () => Promise<void> } | undefined;
  try {
    void Promise.resolve(Browser.addListener("browserFinished", () => {
      void listener?.remove().catch(() => {});
      setTimeout(() => {
        void loadPending().then((flow) => {
          if (flow?.state === state) logDiagnostic("sign-in", `${provider}: browser closed without an answer from the provider`);
        }).catch(() => {});
      }, 3000);
    })).then((handle) => { listener = handle; }).catch(() => {});
  } catch { /* no browser events on this shell */ }
}

/**
 * Handles an incoming app URL for a PIM OAuth flow. Returns true ONLY when it
 * consumed a PIM redirect (matching redirect prefix AND our pending state);
 * otherwise false, so the sync oauthService handler still gets its turn.
 */
export async function handlePimOAuthRedirect(urlStr: string): Promise<boolean> {
  const base = redirectAddress(urlStr);
  if (base !== redirectAddress(MS_REDIRECT_URI) && base !== redirectAddress(GOOGLE_REDIRECT_URI)) return false;
  const flow = await loadPending();
  if (!flow) { logDiagnostic("sign-in", "answer arrived, no sign-in waits for it"); return false; } // let the sync handler try
  const params = new URLSearchParams(urlStr.split("?")[1] ?? "");
  if (params.get("state") !== flow.state) { logDiagnostic("sign-in", "answer of another sign-in"); return false; } // a different (e.g. sync) redirect
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
    if (!claimed) { logDiagnostic("sign-in", "answer already taken"); return true; }
    const error = params.get("error");
    if (error) logDiagnostic("sign-in", `${flow.provider} answered ${error}${params.get("error_subcode") ? ` (${params.get("error_subcode")})` : ""}: ${params.get("error_description") ?? ""}`);
    // Microsoft says "access_denied" for a refusal too; only its "cancel" is the person's own (device finding 2026-10-28).
    if (error === "access_denied" && (flow.provider !== "microsoft" || params.get("error_subcode") === "cancel")) {
      await recordConnectOutcome(flow.serviceContext, (flow.purpose === "mail" || flow.purpose === "gmail") ? "mail" : "calendar", { state: "cancelled" });
      return true;
    }
    if (error) throw new Error([error, params.get("error_description")].filter(Boolean).join(": "));
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
    if (!sameStoredValue(await getPlatformServices().credentials.readSecret(RESULT_KEY), received)) throw new ServiceConnectionError("storageFailed");
    // One slot: a grant that still waited for its vault is written over now,
    // and the notice that offered that vault goes with it — not before: a
    // write that failed has left that grant, and its offer, where they were.
    releaseFlowVault(SIGN_IN_FLOW);
    logDiagnostic("sign-in", `${flow.provider} (${flow.purpose ?? "calendar"}): answer received`);
    await resumePimOAuthResult();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordConnectOutcome(flow.serviceContext, (flow.purpose === "mail" || flow.purpose === "gmail") ? "mail" : "calendar", { state: /wrongAccount|needsConsent|invalid_grant|accountChanged/.test(message) ? "needsConsent" : "failed", message }).catch(() => {});
    if (!wasSignInAnnounced(e)) toast.error(...connectionFailureToast(e));
  }
  return true;
}
