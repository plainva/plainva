import { normalizeVerifiedProviderIdentity, verifiedProviderIdentityKey, type VerifiedProviderIdentity } from "./accountProfile";
import type { CloudAccountRecord, CloudServiceId } from "./cloudAccounts";
import { sameOAuthClient, tokenCoversService, type StoredAccountToken } from "./tokenBroker";
import { AccountGrantMissingPermissionsError } from "./accountLoginGrant";

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

/** Actionable UI copy for failed setup, without exposing transport/storage codes. */
export function serviceConnectionMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof AccountGrantMissingPermissionsError) return t("cloudAccounts.loginGrantIncomplete");
  const value = error instanceof Error ? error.message : String(error);
  if (/redirect_uri_mismatch|invalid_client|invalid_request|Custom URI scheme/.test(value)) return t("connection.googleClientUnsupported");
  if (/wrongAccount/.test(value)) return t("connection.wrongAccount");
  if (/accountChanged|runtime changed|destination_active/.test(value)) return t("connection.accountChanged");
  if (/needsConsent|no_stored_sign_in|invalid_grant/.test(value)) return t("connection.needsConsent");
  if (/identityUnavailable/.test(value)) return t("connection.identityUnavailable");
  if (/storageFailed|storage_failed|not.*saved|secure storage/.test(value)) return t("connection.storageFailed");
  if (/transfer_.*changed|transfer_copy_missing/.test(value)) return t("connection.transferChanged");
  if (/transfer_binding_collision|transfer_ambiguous_destination/.test(value)) return t("connection.transferAccountCollision");
  if (/transfer_incomplete_inventory|transfer_invalid_path/.test(value)) return t("connection.transferInventoryFailed");
  if (/pair-required/.test(value)) return t("connection.transferPairRequired");
  return t("connection.loginFailed");
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
    if (!token?.refreshToken || !sameOAuthClient(token, opts) || !tokenCoversService(token, opts.service, opts.family)) throw new ServiceConnectionError("needsConsent");
  };
  await resolve();
  return { getAccessToken: async (force = false) => { await resolve(); return ports.accessToken(force); } };
}
