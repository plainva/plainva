import {
  accountServices,
  createTokenBroker,
  type CloudProviderFamily,
  type CloudServiceId,
  type TokenBroker,
  type StoredAccountToken,
} from "@plainva/ui";
import {
  DRIVE_DEFAULT_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
  ONEDRIVE_DEFAULT_SCOPE,
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
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

/** Google scopes per audience; Gmail is IMAP, so it is not one of them. */
export function googleScopeFor(audience: string): string {
  if (audience === "files") return DRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GOOGLE_CALENDAR_SCOPES;
  throw new Error(`unknown Google audience: ${audience}`);
}

/** Families whose services can share one refresh token through the broker. */
export function brokerFamily(family: CloudProviderFamily): "microsoft" | "google" | null {
  return family === "microsoft" || family === "google" ? family : null;
}

/** One instance per (vault, account) — see the desktop counterpart. */
const brokers = new Map<string, TokenBroker>();

export function getAccountBroker(vaultId: string, accountId: string, family: "microsoft" | "google" = "microsoft"): TokenBroker {
  const key = accountSecretKey(vaultId, accountId);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    store: {
      read: () => getAccountToken(vaultId, accountId),
      write: (next) => secureCredentialStore.writeSecret(key, next),
    },
    refresh: async ({ clientId, clientSecret, refreshToken, scope }) => {
      if (family === "google") {
        const tokens = await refreshDriveAccessToken({ clientId, clientSecret: clientSecret ?? "", refreshToken }, webdavFetch);
        return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
      }
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, webdavFetch);
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
    },
    scopeFor: family === "google" ? googleScopeFor : microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

/**
 * The one place that decides whether a mobile service reads through the
 * broker: a broker family (Microsoft or Google), account carries the service,
 * account slot present. Everything else keeps its per-service refresh path.
 */
export async function brokerTokenProvider(
  vaultId: string,
  service: CloudServiceId,
): Promise<((force: boolean) => Promise<string>) | undefined> {
  const records = await loadCloudAccounts(vaultId);
  const record = records.find((r) => brokerFamily(r.family) && accountServices(r).includes(service));
  if (!record) return undefined;
  const family = brokerFamily(record.family);
  if (!family) return undefined;
  if (family === "google" && service === "mail") return undefined; // Gmail is IMAP
  if (!(await getAccountToken(vaultId, record.id))) return undefined;

  const broker = getAccountBroker(vaultId, record.id, family);
  return async (force: boolean) => {
    if (force) broker.forget();
    return broker.getAccessToken(service);
  };
}
