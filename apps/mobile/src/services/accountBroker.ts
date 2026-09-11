import {
  accountServices,
  createServiceGrantProbe,
  resolveFileBrokerAccount,
  type FileBrokerBinding,
  createTokenBroker,
  oauthScopeFor,
  sameStoredAccountToken,
  withAccountCredentialLock,
  replaceOAuthClientRegistration,
  sameOAuthClient,
  type CloudProviderFamily,
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

export async function getAccountToken(vaultId: string, accountId: string): Promise<StoredAccountToken | null> {
  return withAccountCredentialLock(accountSecretKey(vaultId, accountId), () => secureCredentialStore.readSecret<StoredAccountToken>(accountSecretKey(vaultId, accountId)));
}

async function forgetAccountMailRuntime(vaultId: string, accountId: string): Promise<void> {
  const record = (await loadCloudAccounts(vaultId)).find((r) => r.id === accountId);
  if (record?.family === "microsoft" && record.services.mail) forgetGraphMailRuntime(vaultId, record.services.mail.mailAccountId);
}

export async function saveAccountToken(vaultId: string, accountId: string, token: StoredAccountToken, expected?: StoredAccountToken | null): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultId, accountId), async () => {
    if (expected !== undefined) {
      const current = await secureCredentialStore.readSecret<StoredAccountToken>(accountSecretKey(vaultId, accountId));
      if (expected === null ? current !== null : !sameStoredAccountToken(current, expected)) throw new Error("The account sign-in changed. Please try again.");
    }
    forgetAccountBroker(vaultId, accountId);
    await secureCredentialStore.writeSecret(accountSecretKey(vaultId, accountId), token);
    if (!sameStoredAccountToken(await secureCredentialStore.readSecret<StoredAccountToken>(accountSecretKey(vaultId, accountId)), token)) throw new Error("The account sign-in could not be confirmed in secure storage.");
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
    const current = await secureCredentialStore.readSecret<StoredAccountToken>(accountSecretKey(vaultId, accountId));
    if (current && sameOAuthClient(current, next)) return false;
    forgetAccountBroker(vaultId, accountId);
    await secureCredentialStore.writeSecret(accountSecretKey(vaultId, accountId), replaceOAuthClientRegistration(current, next));
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

/** Google scopes per audience; Gmail is IMAP, so it is not one of them. */
export function googleScopeFor(audience: string): string {
  const scope = sharedGoogleScopeFor(audience);
  if (!scope) throw new Error(`unknown Google audience: ${audience}`);
  return scope;
}

/** Families whose services can share one refresh token through the broker. */
export function brokerFamily(family: CloudProviderFamily): "microsoft" | "google" | null {
  return family === "microsoft" || family === "google" ? family : null;
}

/** One instance per (vault, account) — see the desktop counterpart. */
const brokers = new Map<string, TokenBroker>();

export function getAccountBroker(vaultId: string, accountId: string, family: "microsoft" | "google" = "microsoft"): TokenBroker {
  const slotKey = accountSecretKey(vaultId, accountId);
  const key = JSON.stringify([slotKey, family]);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    family,
    store: {
      read: () => getAccountToken(vaultId, accountId),
      write: (next, expected) => withAccountCredentialLock(slotKey, async () => {
        const current = await secureCredentialStore.readSecret<StoredAccountToken>(slotKey);
        if (!sameStoredAccountToken(current, expected)) throw new Error("account sign-in changed before rotation could be saved");
        await secureCredentialStore.writeSecret(slotKey, next);
      }),
    },
    refresh: async ({ clientId, clientSecret, refreshToken, scope }) => {
      if (family === "google") {
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
    token: () => getAccountToken(vaultId, accountId),
    accessToken: async (force) => {
      const broker = getAccountBroker(vaultId, accountId, family);
      if (force) broker.forget();
      return broker.getAccessToken(service);
    },
  });
}

/**
 * The one place that decides whether a mobile service reads through the
 * broker: a broker family (Microsoft or Google), account carries the service,
 * account slot present. Everything else keeps its per-service refresh path.
 */
export async function brokerTokenProvider(
  vaultId: string,
  service: CloudServiceId,
  subsystemId?: string,
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (service === "files") return undefined; // Files must supply their concrete provider/client below.
  const records = await loadCloudAccounts(vaultId);
  const candidates = records.filter((record) => {
    if (!brokerFamily(record.family) || !accountServices(record).includes(service)) return false;
    if (record.family === "google" && service === "mail") return false;
    if (!subsystemId) return true;
    if (service === "calendar") return record.services.calendar?.pimAccountId === subsystemId;
    if (service === "mail") return record.services.mail?.mailAccountId === subsystemId;
    return true;
  });
  for (const record of candidates) {
    const family = brokerFamily(record.family);
    if (!family) continue;
    const stored = await getAccountToken(vaultId, record.id);
    if (!stored?.refreshToken) continue;
    if (!tokenCoversService(stored, service, family)) continue;
    return async (force: boolean) => {
      const broker = getAccountBroker(vaultId, record.id, family);
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  return undefined;
}

export async function fileBrokerTokenProvider(vaultId: string, binding: FileBrokerBinding): Promise<((force: boolean) => Promise<string>) | undefined> {
  const resolve = () => loadCloudAccounts(vaultId).then((records) => resolveFileBrokerAccount(records, binding, (id) => getAccountToken(vaultId, id)));
  const record = await resolve();
  if (!record) return undefined;
  return async (force) => {
    if ((await resolve())?.id !== record.id) throw new Error("The file account changed. Reconnect file sync.");
    const broker = getAccountBroker(vaultId, record.id, binding.provider === "drive" ? "google" : "microsoft");
    if (force) broker.forget();
    return broker.getAccessToken("files");
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
  return tokenCoversService(await getAccountToken(vaultId, accountId).catch(() => null), service, family);
}
