import {
  accountServices,
  createTokenBroker,
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

/** Mobile equivalent of the desktop's atomic local client switch. */
export async function replaceAccountClientRegistration(
  vaultId: string,
  accountId: string,
  next: OAuthClientRegistration,
): Promise<boolean> {
  const current = await getAccountToken(vaultId, accountId);
  if (current && sameOAuthClient(current, next)) return false;
  await saveAccountToken(vaultId, accountId, replaceOAuthClientRegistration(current, next));
  return true;
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
  subsystemId?: string,
): Promise<((force: boolean) => Promise<string>) | undefined> {
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
    const broker = getAccountBroker(vaultId, record.id, family);
    return async (force: boolean) => {
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  return undefined;
}

/**
 * Does the shared account token really carry this service?
 *
 * Asked wherever the app was ABOUT to assume it does: skipping a consent,
 * creating a calendar row without one, hiding the unify action. The assumption
 * is what stranded an account — a Drive-only grant was recorded as covering the
 * calendar, and every path that could have corrected it read the same claim
 * back (finding 2026-08-19). Google is the strict case because it cannot widen
 * a grant on refresh; Microsoft keeps the historical rule (a token is enough),
 * since its refresh asks for the service scope and rotation is handled.
 */
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

