import {
  brokerCardsFor,
  brokerFamily,
  describeBrokerLookup as describeSharedBrokerLookup,
  logDiagnostic,
  createServiceGrantProbe,
  resolveFileBrokerAccount,
  type FileBrokerBinding,
  createTokenBroker,
  hasStoredAccountGrant,
  oauthScopeFor,
  sameStoredAccountToken,
  primaryAccountToken,
  selectAccountToken,
  mergeAccountToken,
  rotateAccountToken,
  updateAccountCredentials,
  withAccountCredentialLock,
  replaceOAuthClientRegistration,
  sameOAuthClient,
  type CloudAccountRecord,
  type CloudServiceId,
  type OAuthClientRegistration,
  type TokenBroker,
  googleScopeFor as sharedGoogleScopeFor,
  tokenCoversService as sharedTokenCoversService,
  type StoredAccountToken,
} from "@plainva/ui";
import {
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import { secureCredentialStore } from "../platform/secureStore";
import { webdavFetch } from "../adapters/webdavHttp";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { forgetGraphMailRuntime } from "@plainva/ui/mail";
import { accountCredentialStore } from "./accountCredentialStore";
import { authorizeNativeGoogle, forgetNativeGoogleTokens } from "./googleNativeAuthorization";

/**
 * Mobile half of the account token broker (cloud accounts stage B / E10).
 *
 * Mirrors the desktop wiring against the mobile primitives — secrets go
 * through the Keystore/Keychain-backed store, HTTP through the native bridge —
 * while the decision logic itself lives once in `@plainva/ui`. Without this,
 * the SAME account would follow two different token models on two devices,
 * even though the registry that describes it is synchronised.
 */

export function accountSecretKey(vaultId: string, accountId: string): string {
  return `account_${accountId}_${vaultId}`;
}

async function readAccountCredentials(vaultId: string, accountId: string): Promise<unknown> {
  const raw = await accountCredentialStore.read(accountSecretKey(vaultId, accountId));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (value === null) throw new Error("The stored account sign-in is invalid");
  return value;
}

export async function getAccountToken(vaultId: string, accountId: string, audience?: string, family?: "google" | "microsoft", client?: OAuthClientRegistration): Promise<StoredAccountToken | null> {
  return withAccountCredentialLock(accountSecretKey(vaultId, accountId), async () => {
    const raw = await readAccountCredentials(vaultId, accountId);
    return audience && family ? selectAccountToken(raw, family, audience, client) : primaryAccountToken(raw);
  });
}

async function forgetAccountMailRuntime(vaultId: string, accountId: string): Promise<void> {
  const record = (await loadCloudAccounts(vaultId)).find((r) => r.id === accountId);
  if (record?.family === "microsoft" && record.services.mail) forgetGraphMailRuntime(vaultId, record.services.mail.mailAccountId);
}

export async function saveAccountToken(vaultId: string, accountId: string, token: StoredAccountToken, expected?: StoredAccountToken | null): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultId, accountId), async () => {
    await updateAccountCredentials(accountCredentialStore, accountSecretKey(vaultId, accountId), (raw) => {
      if (expected !== undefined) {
        const current = primaryAccountToken(raw);
        if (expected === null ? current !== null : !sameStoredAccountToken(current, expected)) throw new Error("The account sign-in changed. Please try again.");
      }
      return mergeAccountToken(raw, token);
    });
    forgetAccountBroker(vaultId, accountId);
  });
  await forgetAccountMailRuntime(vaultId, accountId);
}

/** Mobile equivalent of the desktop's atomic local client switch. */
export async function replaceAccountClientRegistration(
  vaultId: string,
  accountId: string,
  next: OAuthClientRegistration,
): Promise<boolean> {
  return withAccountCredentialLock(accountSecretKey(vaultId, accountId), async () => {
    const current = primaryAccountToken(await readAccountCredentials(vaultId, accountId));
    if (current && sameOAuthClient(current, next)) return false;
    forgetAccountBroker(vaultId, accountId);
    await updateAccountCredentials(accountCredentialStore, accountSecretKey(vaultId, accountId), (raw) =>
      mergeAccountToken(raw, replaceOAuthClientRegistration(primaryAccountToken(raw), next)));
    await forgetAccountMailRuntime(vaultId, accountId);
    return true;
  });
}

export async function clearAccountToken(vaultId: string, accountId: string): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultId, accountId), async () => {
    forgetAccountBroker(vaultId, accountId);
    await secureCredentialStore.removeSecret(accountSecretKey(vaultId, accountId));
    await forgetAccountMailRuntime(vaultId, accountId);
  });
}

export function microsoftScopeFor(audience: string): string {
  const scope = oauthScopeFor("microsoft", audience);
  if (!scope) throw new Error(`unknown audience: ${audience}`);
  return scope;
}

/** Required Google permissions for each service, including Gmail XOAUTH2. */
export function googleScopeFor(audience: string): string {
  const scope = sharedGoogleScopeFor(audience);
  if (!scope) throw new Error(`unknown Google audience: ${audience}`);
  return scope;
}

/** Families whose services can share one refresh token through the broker. */
export { brokerFamily };

/** One instance per (vault, account) — see the desktop counterpart. */
const brokers = new Map<string, TokenBroker>();

async function adoptLegacyGrant(vaultId: string, record: CloudAccountRecord, service: CloudServiceId): Promise<boolean> {
  try {
    const { migrateLegacyAccountGrant } = await import("./accountGrantMigration");
    await migrateLegacyAccountGrant(vaultId, record, service);
    return true;
  } catch {
    logDiagnostic("sync", `The existing ${service} sign-in could not be adopted; its service source was kept.`);
    return false;
  }
}

export function getAccountBroker(vaultId: string, accountId: string, family: "microsoft" | "google" = "microsoft"): TokenBroker {
  const slotKey = accountSecretKey(vaultId, accountId);
  const key = JSON.stringify([slotKey, family]);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    family,
    onForget: family === "google" ? forgetNativeGoogleTokens : undefined,
    store: {
      read: (audience, client) => getAccountToken(vaultId, accountId, audience, family, client),
      write: (next, expected) => withAccountCredentialLock(slotKey, async () => {
        await updateAccountCredentials(accountCredentialStore, slotKey, (current) => rotateAccountToken(current, next, expected));
      }),
    },
    refresh: async ({ clientId, clientSecret, refreshToken, scope, ...nativeGrant }) => {
      if (family === "google") {
        if (nativeGrant.nativeGoogle) return authorizeNativeGoogle(scope, false, { ...nativeGrant, clientId, refreshToken });
        const tokens = await refreshDriveAccessToken({ clientId, clientSecret: clientSecret ?? "", refreshToken }, webdavFetch);
        return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, scope: tokens.scope };
      }
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, webdavFetch);
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, scope: tokens.scope };
    },
    scopeFor: family === "google" ? googleScopeFor : microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

export function forgetAccountBroker(vaultId: string, accountId: string): void {
  for (const family of ["google", "microsoft"]) {
    const key = JSON.stringify([accountSecretKey(vaultId, accountId), family]);
    brokers.get(key)?.forget();
    brokers.delete(key);
  }
}

export function calendarGrantProbe(vaultId: string, accountId: string, family: "google" | "microsoft", client: { clientId: string; clientSecret?: string }) {
  return serviceGrantProbe(vaultId, accountId, family, "calendar", client);
}
export function fileGrantProbe(vaultId: string, accountId: string, family: "google" | "microsoft", client: { clientId: string; clientSecret?: string }) {
  return serviceGrantProbe(vaultId, accountId, family, "files", client);
}
function serviceGrantProbe(vaultId: string, accountId: string, family: "google" | "microsoft", service: CloudServiceId, client: { clientId: string; clientSecret?: string }) {
  return createServiceGrantProbe({ accountId, family, service, ...client }, {
    records: () => loadCloudAccounts(vaultId),
    token: () => getAccountToken(vaultId, accountId, service, family, client),
    accessToken: async (force) => {
      const broker = getAccountBroker(vaultId, accountId, family);
      if (force) broker.forget();
      return broker.getAccessToken(service, client);
    },
  });
}

/**
 * The one place that decides whether a mobile service reads through the
 * broker: a broker family (Microsoft or Google), a card that carries the
 * service for the account that asks, account slot present. Everything else
 * keeps its per-service refresh path.
 */
export async function brokerTokenProvider(
  vaultId: string,
  service: CloudServiceId,
  /**
   * The subsystem account that is asking (pim row / mail account). Required:
   * as an option it could be left out, and mail left it out — every mailbox of
   * a vault then drew the sign-in of the first card (finding 2026-10-12).
   */
  subsystemId: string,
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (service === "files") return undefined; // Files must supply their concrete provider/client below.
  // A card that points at the account that asks, and no other
  // (`brokerCardsFor`): no match means no broker, and the service falls back
  // to its own sign-in — never to a stranger's.
  const records = await loadCloudAccounts(vaultId);
  for (const record of brokerCardsFor(records, service, subsystemId)) {
    const family = brokerFamily(record.family);
    if (!family) continue;
    if (!await adoptLegacyGrant(vaultId, record, service)) continue;
    const stored = await getAccountToken(vaultId, record.id, service, family);
    if (!hasStoredAccountGrant(stored)) continue;
    if (!tokenCoversService(stored, service, family)) continue;
    return async (force: boolean) => {
      const broker = getAccountBroker(vaultId, record.id, family);
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  return undefined;
}

/**
 * Why the broker did not answer for this account, in one sentence, for the
 * error a person reads — the shared rule (`@plainva/ui`) over this shell's
 * registry and account slots. The desktop has said it since 2026-07-30; the
 * phone's mailbox only said that a sign-in was missing.
 */
export async function describeBrokerLookup(vaultId: string, service: CloudServiceId, subsystemId: string): Promise<string> {
  return describeSharedBrokerLookup(
    {
      records: () => loadCloudAccounts(vaultId),
      token: (accountId, forService, family) => getAccountToken(vaultId, accountId, forService, family),
    },
    service,
    subsystemId,
  );
}

export async function fileBrokerTokenProvider(vaultId: string, binding: FileBrokerBinding): Promise<((force: boolean) => Promise<string>) | undefined> {
  const candidates = (await loadCloudAccounts(vaultId)).filter((record) => record.family === (binding.provider === "drive" ? "google" : "microsoft")
    && record.services.files?.provider === binding.provider && (!binding.accountId || record.id === binding.accountId));
  for (const candidate of candidates) if (!await adoptLegacyGrant(vaultId, candidate, "files")) return undefined;
  const resolve = () => loadCloudAccounts(vaultId).then((records) => resolveFileBrokerAccount(records, binding, (id) => getAccountToken(vaultId, id, "files", binding.provider === "drive" ? "google" : "microsoft", binding)));
  const record = await resolve();
  if (!record) return undefined;
  return async (force) => {
    if ((await resolve())?.id !== record.id) throw new Error("The file account changed. Reconnect file sync.");
    const broker = getAccountBroker(vaultId, record.id, binding.provider === "drive" ? "google" : "microsoft");
    if (force) broker.forget();
    return broker.getAccessToken("files", binding);
  };
}

/** The same recorded-grant rule as desktop. Older Microsoft slots without
 * recorded scopes must still pass the actual access-token response check. */
export function tokenCoversService(
  token: StoredAccountToken | null,
  service: CloudServiceId,
  family: "google" | "microsoft",
): boolean {
  return sharedTokenCoversService(token, service, family);
}

/** The same question against the stored slot. */
export async function accountTokenCovers(
  vaultId: string,
  accountId: string,
  service: CloudServiceId,
  family: "google" | "microsoft",
): Promise<boolean> {
  return tokenCoversService(await getAccountToken(vaultId, accountId, service, family).catch(() => null), service, family);
}
