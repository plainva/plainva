/** Match an ordered pair within a line without backtracking through every prefix. */
function hasOrderedWords(text: string, first: string, second: string): boolean {
  return text.split(/[\r\n\u2028\u2029]/).some(line => {
    const start = line.indexOf(first);
    return start >= 0 && line.indexOf(second, start + first.length) >= 0;
  });
}

import { normalizeVerifiedProviderIdentity, verifiedProviderIdentityKey, type VerifiedProviderIdentity } from "./accountProfile";
import type { CloudAccountRecord, CloudServiceId } from "./cloudAccounts";
import { hasStoredAccountGrant, sameOAuthClient, tokenCoversService, type StoredAccountToken } from "./tokenBroker";
import { AccountGrantMissingPermissionsError } from "./accountLoginGrant";
import { connectionFailureCode } from "@plainva/core";
import { googleAuthorizationMessage } from "./googleAuthorization";
import type { AccessPlatform } from "./oauthAccess";

/** Non-secret destination carried across screens and native browser returns. */
export interface ServiceConnectionContext {
  vaultId: string;
  cloudAccountId?: string;
  expectedIdentity?: VerifiedProviderIdentity;
  runId?: string;
}

export type ServiceConnectionOutcome =
  | { state: "connected" | "alreadyConnected"; bindingId: string }
  | { state: "needsConsent" | "cancelled" | "failed"; message?: string };

export class ServiceConnectionError extends Error {
  constructor(public readonly reason: "accountChanged" | "wrongAccount" | "needsConsent" | "identityUnavailable" | "storageFailed") {
    super(reason);
    this.name = "ServiceConnectionError";
  }
}

/** A translator: react-i18next's `t` and `i18n.t` both fit. */
export type ConnectionTranslate = (key: string, options?: Record<string, unknown>) => string;

/** What the shell knows about where the failure happened. */
export interface ConnectionMessageContext {
  /** The device's access platform (`oauthAccess.ts`); absent = say it for both. */
  platform?: AccessPlatform;
}

/**
 * Google refused the client for this device's return address (issue 142).
 *
 * A Desktop-type client only allows a loopback return, an iOS-type client only
 * the app's custom scheme. So `redirect_uri_mismatch` on a phone means "not an
 * iOS client — in practice a Desktop one", and on a computer "not a Desktop
 * client". The client ID itself cannot tell (every type is
 * `…apps.googleusercontent.com`), and Google usually shows the error on its
 * own page in the browser; the editor of the own client therefore says the
 * same in advance. When the answer does reach Plainva, it is named here.
 */
function isGoogleClientTypeMismatch(value: string): boolean {
  return value.includes("redirect_uri_mismatch");
}

const GOOGLE_CLIENT_TYPE_KEYS: Record<AccessPlatform | "unknown", string> = {
  desktop: "connection.googleClientWrongTypeDesktop",
  ios: "connection.googleClientWrongTypePhone",
  android: "connection.googleClientWrongTypePhone",
  unknown: "connection.googleClientWrongType",
};

/**
 * Whether a failed connection is about the Google client registration, so the
 * surface showing the sentence can offer the guide (`googleClientGuideUrl`).
 */
export function isGoogleClientProblem(error: unknown): boolean {
  if (error instanceof ServiceConnectionError) return false;
  return /redirect_uri_mismatch|invalid_client|Custom URI scheme/.test(rawText(error));
}

/**
 * The provider refuses the CLIENT, not the person: deleted in its project,
 * not allowed for this kind of request, or not found (plan "Verbinden", V0).
 * Signing in again with the same client cannot help; switching this device to
 * the standard sign-in can.
 */
export function isOwnClientRejected(error: unknown): boolean {
  if (error instanceof ServiceConnectionError) return false;
  return /deleted_client|unauthorized_client|invalid_client/.test(rawText(error));
}

/** The sentence for each reason a connection flow names itself. */
const REASON_KEYS: Record<ServiceConnectionError["reason"], string> = {
  accountChanged: "connection.accountChanged",
  wrongAccount: "connection.wrongAccount",
  needsConsent: "connection.needsConsent",
  identityUnavailable: "connection.identityUnavailable",
  storageFailed: "connection.signedInNotSaved",
};

function rawText(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return error === null || error === undefined ? "" : String(error).trim();
}

/**
 * THE text for a failed connection, in both shells (finding 2026-09-24, E3).
 *
 * There used to be two: the phone translated known codes and swallowed
 * everything else into "could not be completed", while the desktop wizard
 * printed whatever it caught — which is how "storageFailed" stood on the
 * screen where a sentence belonged. Now there is one rule:
 *   - a code Plainva knows becomes its sentence (`ServiceConnectionError`
 *     reasons first, then the classes of a failed Android Google sign-in,
 *     then the connection and loopback markers, then the
 *     storage and transfer wordings of older throw sites);
 *   - anything else is the provider's own answer and is shown VERBATIM, framed
 *     as such — "access_denied: the app is not verified" says more than any
 *     replacement could, but it must never look like Plainva's sentence;
 *   - nothing at all still says something: the generic retry sentence.
 */
export function serviceConnectionMessage(error: unknown, t: ConnectionTranslate, context: ConnectionMessageContext = {}): string {
  if (error instanceof ServiceConnectionError) return t(REASON_KEYS[error.reason]);
  // Android: Play services said why (lib/googleAuthorization.ts). Asked before
  // anything else, so that a refused registration never reads as "cancelled".
  const google = googleAuthorizationMessage(error, t);
  if (google) return google;
  const connection = connectionFailureCode(error);
  if (connection) return t(`connectionFailure.${connection}`);
  if (error instanceof AccountGrantMissingPermissionsError) return t("cloudAccounts.loginGrantIncomplete");
  const value = rawText(error);
  // Before the loopback markers: "oauth error in redirect: redirect_uri_mismatch"
  // is the client type, not a provider sentence to pass through.
  if (isGoogleClientTypeMismatch(value)) return t(GOOGLE_CLIENT_TYPE_KEYS[context.platform ?? "unknown"]);
  // The desktop's OAuth loopback reports in marker sentences (N1/S1).
  if (value.includes("oauth loopback cancelled") || value === "cancelled") return t("settings.oauthCancelled");
  if (value.includes("oauth loopback timed out")) return t("settings.oauthTimedOut");
  if (value.includes("oauth error in redirect")) {
    const detail = value.split("oauth error in redirect:").pop()?.trim();
    return detail ? t("settings.oauthProviderError", { detail }) : t("settings.oauthCancelled");
  }
  if (/deleted_client|unauthorized_client/.test(value)) return t("accountAccess.clientRejected");
  if (/invalid_client|invalid_request|Custom URI scheme/.test(value)) return t("connection.googleClientUnsupported");
  if (/wrongAccount/.test(value)) return t("connection.wrongAccount");
  // A calendar runtime replaced under a connection is the VAULT reloading or
  // switching - never "the target account changed", which sent people looking
  // for an account mix-up that did not exist (finding 2026-10-26).
  if (/runtime changed/.test(value)) return t("connection.runtimeChanged");
  if (/accountChanged|destination_active/.test(value)) return t("connection.accountChanged");
  if (/needsConsent|no_stored_sign_in|invalid_grant/.test(value)) return t("connection.needsConsent");
  if (/identityUnavailable/.test(value)) return t("connection.identityUnavailable");
  if (/storageFailed|storage_failed|secure storage/.test(value) || hasOrderedWords(value, "not", "saved")) return t("connection.storageFailed");
  if (value.includes("transfer_copy_missing") || hasOrderedWords(value, "transfer_", "changed")) return t("connection.transferChanged");
  if (/transfer_binding_collision|transfer_ambiguous_destination/.test(value)) return t("connection.transferAccountCollision");
  if (/transfer_incomplete_inventory|transfer_invalid_path/.test(value)) return t("connection.transferInventoryFailed");
  if (/pair-required/.test(value)) return t("connection.transferPairRequired");
  if (!value || value === "failed" || value === "loginFailed" || value === "[object Object]") return t("connection.loginFailed");
  return t("connection.providerResponse", { detail: value });
}

export function assertConnectionIdentity(expected: VerifiedProviderIdentity | undefined, actual: VerifiedProviderIdentity | null): void {
  if (!actual) throw new ServiceConnectionError("identityUnavailable");
  if (expected && verifiedProviderIdentityKey(expected) !== verifiedProviderIdentityKey(actual)) throw new ServiceConnectionError("wrongAccount");
}

/** A provisional service has no subsystem id yet. It must name its exact
 * account slot, and revalidate that slot before every token read. */
export async function createServiceGrantProbe(
  opts: { accountId: string; family: "google" | "microsoft"; service: CloudServiceId; clientId: string; clientSecret?: string; allowUnbound?: boolean; expectedIdentity?: VerifiedProviderIdentity },
  ports: { records(): Promise<CloudAccountRecord[]>; token(): Promise<StoredAccountToken | null>; accessToken(force: boolean): Promise<string> },
): Promise<{ getAccessToken(force?: boolean): Promise<string> }> {
  const resolve = async () => {
    const record = (await ports.records()).find(r => r.id === opts.accountId);
    if ((!record && !opts.allowUnbound) || (record && record.family !== opts.family)) throw new ServiceConnectionError("accountChanged");
    const identity = normalizeVerifiedProviderIdentity(record?.verifiedProviderIdentity);
    if (opts.expectedIdentity && (!identity || verifiedProviderIdentityKey(identity) !== verifiedProviderIdentityKey(opts.expectedIdentity))) throw new ServiceConnectionError("accountChanged");
    const token = await ports.token();
    // A system-sheet grant (Android) holds no refresh token and is still a grant.
    if (!hasStoredAccountGrant(token) || !sameOAuthClient(token, opts) || !tokenCoversService(token, opts.service, opts.family)) throw new ServiceConnectionError("needsConsent");
  };
  await resolve();
  return { getAccessToken: async (force = false) => { await resolve(); return ports.accessToken(force); } };
}
