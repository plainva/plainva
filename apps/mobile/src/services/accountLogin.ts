import {
  DRIVE_DEFAULT_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
  ONEDRIVE_DEFAULT_SCOPE,
} from "@plainva/core";
import { GRAPH_MAIL_SCOPES, listMailAccounts } from "@plainva/ui/mail";
import { accountOAuthServices, tokenCoversService, GOOGLE_MAIL_SCOPES, type CloudAccountRecord, type CloudServiceId } from "@plainva/ui";
import { brokerFamily, getAccountToken } from "./accountBroker";

/**
 * One sign-in for a whole account, on the phone (Sammelplan C5).
 *
 * The desktop has offered this since stage B; the phone signed in per service,
 * so an account connected here kept one refresh token per service — the exact
 * arrangement that let a Google calendar hold a dead token while the file sync
 * had a fresh one (finding 2026-07-28). A device that syncs the same account as
 * the desktop should not follow a different token model.
 *
 * Deliberately reuses the PIM OAuth transaction rather than adding a third one:
 * it already survives a cold start, carries a purpose through the single
 * redirect handler and takes an explicit scope. This adds the `account` purpose
 * and the union scope; everything else is the existing, tested path.
 */

/** Union of the scopes for the services this account actually carries. */
export function unionScopeFor(family: "microsoft" | "google", services: readonly CloudServiceId[]): string {
  const parts = new Set<string>();
  for (const service of services) {
    if (family === "google") {
      if (service === "files") for (const s of DRIVE_DEFAULT_SCOPE.split(/\s+/)) parts.add(s);
      if (service === "calendar") for (const s of GOOGLE_CALENDAR_SCOPES.split(/\s+/)) parts.add(s);
      if (service === "mail") for (const s of GOOGLE_MAIL_SCOPES.split(/\s+/)) parts.add(s);
    } else {
      const scope =
        service === "files" ? ONEDRIVE_DEFAULT_SCOPE : service === "calendar" ? GRAPH_CALENDAR_SCOPES : GRAPH_MAIL_SCOPES;
      for (const s of scope.split(/\s+/)) if (s) parts.add(s);
    }
  }
  return [...parts].join(" ");
}

/** Services of this account that an OAuth consent can actually cover. */
export function oauthServicesOf(record: CloudAccountRecord, mailKind?: string): CloudServiceId[] {
  return accountOAuthServices(record, mailKind);
}

async function oauthServicesInVault(vault: string, record: CloudAccountRecord): Promise<CloudServiceId[]> {
  const mail = record.services.mail ? (await listMailAccounts(vault)).find(row => row.id === record.services.mail!.mailAccountId) : undefined;
  return oauthServicesOf(record, mail?.kind);
}

/**
 * Whether this account can be moved onto one shared token: a broker family,
 * more than one OAuth-backed service, and a shared sign-in that does not
 * already carry all of them.
 *
 * The last part used to be "no account slot yet", and that turned the action
 * into a one-way door: the moment a token existed the offer disappeared, even
 * when the token demonstrably did not cover the calendar. Together with a
 * re-authorisation that wrote to a slot nobody read, it left the account with
 * no way back at all (finding 2026-08-19). A token that falls short of the
 * account's services is exactly the state this action repairs.
 */
export async function canUnifyMobileAccount(vaultId: string, record: CloudAccountRecord): Promise<boolean> {
  const family = brokerFamily(record.family);
  if (!family) return false;
  const services = await oauthServicesInVault(vaultId, record);
  if (services.length < 2) return false;
  const covered = await Promise.all(services.map(async (service) => tokenCoversService(await getAccountToken(vaultId, record.id, service, family).catch(() => null), service, family)));
  return covered.some((hasGrant) => !hasGrant);
}

export interface AccountLoginStatus { vaultId: string; accountId: string; services: Partial<Record<CloudServiceId, string>>; message?: string }
const loginStates = new Map<string, AccountLoginStatus>();
export const ACCOUNT_LOGIN_STATUS_EVENT = "m-account-login-status";
export function getAccountLoginStatus(vaultId: string, accountId: string): AccountLoginStatus | undefined {
  return loginStates.get(JSON.stringify([vaultId, accountId]));
}
export function announceAccountLogin(status: AccountLoginStatus): void {
  loginStates.set(JSON.stringify([status.vaultId, status.accountId]), structuredClone(status));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ACCOUNT_LOGIN_STATUS_EVENT, { detail: status }));
}
