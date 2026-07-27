import { accountServices, createTokenBroker, type CloudServiceId, type TokenBroker, type StoredAccountToken } from "@plainva/ui";
import { GRAPH_CALENDAR_SCOPES, ONEDRIVE_DEFAULT_SCOPE, refreshOneDriveAccessToken } from "@plainva/core";
import { GRAPH_MAIL_SCOPES } from "@plainva/ui/mail";
import { secureCredentialStore } from "../platform/secureStore";
import { webdavFetch } from "../adapters/webdavHttp";
import { loadCloudAccounts } from "./cloudAccountsStore";

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
  return secureCredentialStore.readSecret<StoredAccountToken>(accountSecretKey(vaultId, accountId));
}

export async function saveAccountToken(vaultId: string, accountId: string, token: StoredAccountToken): Promise<void> {
  await secureCredentialStore.writeSecret(accountSecretKey(vaultId, accountId), token);
  brokers.delete(accountSecretKey(vaultId, accountId));
}

export async function clearAccountToken(vaultId: string, accountId: string): Promise<void> {
  await secureCredentialStore.removeSecret(accountSecretKey(vaultId, accountId));
  brokers.delete(accountSecretKey(vaultId, accountId));
}

export function microsoftScopeFor(audience: string): string {
  if (audience === "files") return ONEDRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GRAPH_CALENDAR_SCOPES;
  if (audience === "mail") return GRAPH_MAIL_SCOPES;
  throw new Error(`unknown audience: ${audience}`);
}

/** One instance per (vault, account) — see the desktop counterpart. */
const brokers = new Map<string, TokenBroker>();

export function getAccountBroker(vaultId: string, accountId: string): TokenBroker {
  const key = accountSecretKey(vaultId, accountId);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    store: {
      read: () => getAccountToken(vaultId, accountId),
      write: (next) => secureCredentialStore.writeSecret(key, next),
    },
    refresh: async ({ clientId, refreshToken, scope }) => {
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, webdavFetch);
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
    },
    scopeFor: microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

/**
 * The one place that decides whether a mobile service reads through the
 * broker: Microsoft family, account carries the service, account slot present.
 * Everything else keeps its per-service refresh path.
 */
export async function brokerTokenProvider(
  vaultId: string,
  service: CloudServiceId,
): Promise<((force: boolean) => Promise<string>) | undefined> {
  const records = await loadCloudAccounts(vaultId);
  const record = records.find((r) => r.family === "microsoft" && accountServices(r).includes(service));
  if (!record) return undefined;
  if (!(await getAccountToken(vaultId, record.id))) return undefined;

  const broker = getAccountBroker(vaultId, record.id);
  return async (force: boolean) => {
    if (force) broker.forget();
    return broker.getAccessToken(service);
  };
}
