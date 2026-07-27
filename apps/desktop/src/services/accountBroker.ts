import { accountServices, createTokenBroker, type CloudServiceId, type TokenBroker, type StoredAccountToken } from "@plainva/ui";
import { loadCloudAccounts } from "./cloudAccounts";
import { GRAPH_CALENDAR_SCOPES, ONEDRIVE_DEFAULT_SCOPE, refreshOneDriveAccessToken } from "@plainva/core";
import { GRAPH_MAIL_SCOPES } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { microsoftAuthFetch } from "./authFetch";

/**
 * Desktop wiring of the shared token broker (cloud accounts stage B / B3).
 *
 * A Microsoft account that was connected through the wizard's union consent
 * keeps ONE refresh token in an account slot; file sync, calendar and mail all
 * draw their access tokens from here instead of holding a copy each. Accounts
 * connected before this existed keep their per-service slots and their old
 * refresh paths — nothing is migrated behind the user's back (decision E8).
 */

/** Keychain slot for the account-wide token, per vault (ADR 0005 shape). */
export function accountSecretKey(vaultPath: string, accountId: string): string {
  return `account_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
}

export async function getAccountToken(vaultPath: string, accountId: string): Promise<StoredAccountToken | null> {
  return credentialManager.readSecret<StoredAccountToken>(accountSecretKey(vaultPath, accountId));
}

export async function saveAccountToken(vaultPath: string, accountId: string, token: StoredAccountToken): Promise<void> {
  await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), token);
  forgetAccountBroker(vaultPath, accountId);
}

export async function clearAccountToken(vaultPath: string, accountId: string): Promise<void> {
  await credentialManager.removeSecret(accountSecretKey(vaultPath, accountId));
  forgetAccountBroker(vaultPath, accountId);
}

/** Delegated Graph scopes per audience — the union of what the account uses. */
export function microsoftScopeFor(audience: string): string {
  if (audience === "files") return ONEDRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GRAPH_CALENDAR_SCOPES;
  if (audience === "mail") return GRAPH_MAIL_SCOPES;
  throw new Error(`unknown audience: ${audience}`);
}

/** Union of the scopes of the services an account actually connects. */
export function microsoftUnionScope(audiences: readonly string[]): string {
  const parts = new Set<string>();
  for (const audience of audiences) {
    for (const scope of microsoftScopeFor(audience).split(/\s+/)) if (scope) parts.add(scope);
  }
  return [...parts].join(" ");
}

/**
 * One broker instance per (vault, account) so the single-flight guarantee
 * actually holds across the three subsystems — a fresh instance per call would
 * give every consumer its own in-flight map and defeat the purpose.
 */
const brokers = new Map<string, TokenBroker>();

export function getAccountBroker(vaultPath: string, accountId: string): TokenBroker {
  const key = accountSecretKey(vaultPath, accountId);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    store: {
      read: () => getAccountToken(vaultPath, accountId),
      write: async (next) => {
        await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), next);
      },
    },
    refresh: async ({ clientId, refreshToken, scope }) => {
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, microsoftAuthFetch);
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    },
    scopeFor: microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

export function forgetAccountBroker(vaultPath: string, accountId: string): void {
  brokers.delete(accountSecretKey(vaultPath, accountId));
}

/**
 * The ONE place that decides whether a service draws its access token from the
 * account broker: the account must be Microsoft, must carry that service, and
 * must actually have an account-wide token (i.e. it was connected through the
 * union consent). Everything else keeps its per-service refresh path, so
 * accounts connected before stage B are untouched.
 *
 * Returns the provider shape `OneDriveSyncTarget.accessTokenProvider` and the
 * PIM/mail runtimes expect: `force` drops a cached token the server rejected.
 */
/**
 * Set while the wizard connects a Microsoft account through the union consent:
 * the account slot already holds the token, but the registry record only comes
 * into being after all services bound. Without this, the very validations that
 * run DURING the connect (listing calendars, reading the mailbox address)
 * would find no account and fall back to an empty per-service token.
 */
let pendingAccount: { vaultPath: string; accountId: string } | null = null;
export function setPendingBrokerAccount(next: { vaultPath: string; accountId: string } | null): void {
  pendingAccount = next;
}

export async function brokerTokenProvider(
  vaultPath: string,
  service: CloudServiceId
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (pendingAccount && pendingAccount.vaultPath === vaultPath) {
    const broker = getAccountBroker(vaultPath, pendingAccount.accountId);
    return async (force: boolean) => {
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  const records = await loadCloudAccounts(vaultPath);
  const record = records.find((r) => r.family === "microsoft" && accountServices(r).includes(service));
  if (!record) return undefined;
  if (!(await getAccountToken(vaultPath, record.id))) return undefined;

  const broker = getAccountBroker(vaultPath, record.id);
  return async (force: boolean) => {
    if (force) broker.forget();
    return broker.getAccessToken(service);
  };
}
