import {
  DRIVE_DEFAULT_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
  ONEDRIVE_DEFAULT_SCOPE,
} from "@plainva/core";
import { GRAPH_MAIL_SCOPES } from "@plainva/ui/mail";
import { accountServices, toast, tokenCoversService, type CloudAccountRecord, type CloudServiceId } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { beginPimOAuth, setOAuthPurposeHandler } from "./pim/pimOAuth";
import { brokerFamily, getAccountToken, saveAccountToken } from "./accountBroker";
import { getPimCredentials, savePimCredentials } from "./pim/pimCredentials";
import { getStoredProvider, switchProviderToAccountBroker } from "./syncService";

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
      // Gmail runs over IMAP with an app password, so it never widens an
      // OAuth consent — asking for mail scopes here would be asking for
      // permission we have no use for.
      if (service === "files") for (const s of DRIVE_DEFAULT_SCOPE.split(/\s+/)) parts.add(s);
      if (service === "calendar") for (const s of GOOGLE_CALENDAR_SCOPES.split(/\s+/)) parts.add(s);
    } else {
      const scope =
        service === "files" ? ONEDRIVE_DEFAULT_SCOPE : service === "calendar" ? GRAPH_CALENDAR_SCOPES : GRAPH_MAIL_SCOPES;
      for (const s of scope.split(/\s+/)) if (s) parts.add(s);
    }
  }
  return [...parts].join(" ");
}

/** Services of this account that an OAuth consent can actually cover. */
export function oauthServicesOf(record: CloudAccountRecord): CloudServiceId[] {
  const services = accountServices(record);
  return record.family === "google" ? services.filter((s) => s !== "mail") : services;
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
  const services = oauthServicesOf(record);
  if (services.length < 2) return false;
  const stored = await getAccountToken(vaultId, record.id).catch(() => null);
  if (!stored?.refreshToken) return true;
  return services.some((service) => !tokenCoversService(stored, service, family));
}

/** The client this account signs in with, read from whichever slot has one. */
async function clientOf(
  vaultId: string,
  record: CloudAccountRecord
): Promise<{ clientId: string; clientSecret?: string } | null> {
  const account = await getAccountToken(vaultId, record.id);
  if (account?.clientId) {
    return {
      clientId: account.clientId,
      ...(account.clientSecret ? { clientSecret: account.clientSecret } : {}),
    };
  }
  const provider = await getStoredProvider(vaultId);
  if (provider && (provider.provider === "drive" || provider.provider === "onedrive")) {
    const creds = provider.creds as { clientId?: string; clientSecret?: string };
    if (creds.clientId) return { clientId: creds.clientId, ...(creds.clientSecret ? { clientSecret: creds.clientSecret } : {}) };
  }
  const pimId = record.services.calendar?.pimAccountId;
  if (pimId) {
    const creds = await getPimCredentials(vaultId, pimId);
    if (creds && (creds.kind === "google" || creds.kind === "microsoft") && creds.clientId) {
      return {
        clientId: creds.clientId,
        ...(creds.kind === "google" && creds.clientSecret ? { clientSecret: creds.clientSecret } : {}),
      };
    }
  }
  return null;
}

/** The account whose consent is currently running, so the handler can bind it. */
let pendingAccount: { vaultId: string; record: CloudAccountRecord } | null = null;

/** Opens ONE consent covering every OAuth service of the account. */
export async function beginAccountLogin(vaultId: string, record: CloudAccountRecord): Promise<void> {
  const family = brokerFamily(record.family);
  if (!family) throw new Error("this account cannot share one login");
  const services = oauthServicesOf(record);
  if (services.length === 0) throw new Error("this account has no service that signs in with OAuth");
  const client = await clientOf(vaultId, record);
  if (!client) throw new Error("no client id for this account");

  pendingAccount = { vaultId, record };
  await beginPimOAuth(family, {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    label: record.label ?? "",
    purpose: "account",
    scope: unionScopeFor(family, services),
  });
}

/**
 * Completes the union consent: the token goes into the ACCOUNT slot and the
 * per-service copies are emptied, so nothing keeps refreshing one on the side.
 * Order matters — the account slot is written first, so a failure while
 * clearing the old copies leaves the account working either way.
 */
export function registerAccountLoginHandler(): void {
  setOAuthPurposeHandler("account", async ({ clientId, clientSecret, refreshToken, grantedScope }) => {
    const target = pendingAccount;
    pendingAccount = null;
    if (!target) throw new Error("no account sign-in pending");
    const { vaultId, record } = target;
    const family = brokerFamily(record.family);
    if (!family) throw new Error("this account cannot share one login");

    // The grant decides what this token can do, not the request. Google
    // silently narrows a consent (a user can untick a service on the screen)
    // and cannot widen it on refresh, so writing the union we ASKED for made
    // every service believe it was covered (finding 2026-08-19). No grant
    // reported → no claim recorded.
    const granted = grantedScope?.trim();
    await saveAccountToken(vaultId, record.id, {
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      refreshToken,
      ...(granted ? { scopes: granted } : {}),
    });

    await switchProviderToAccountBroker(vaultId);
    const pimId = record.services.calendar?.pimAccountId;
    if (pimId) {
      const creds = await getPimCredentials(vaultId, pimId);
      if (creds && (creds.kind === "google" || creds.kind === "microsoft")) {
        await savePimCredentials(vaultId, pimId, { ...creds, refreshToken: "" });
      }
    }

    toast.success(i18n.t("cloudAccounts.loginUnified"));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-pim-changed"));
  });
}
