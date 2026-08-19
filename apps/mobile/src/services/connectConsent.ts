import { FAMILY_SERVICES, type CloudProviderFamily, type CloudServiceId } from "@plainva/ui";

import { unionScopeFor } from "./accountLogin";
import { getAccountToken, saveAccountToken } from "./accountBroker";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { getStoredProvider, switchProviderToAccountBroker } from "./syncService";

/**
 * One consent for a whole run (S0b3).
 *
 * Google and Microsoft share ONE account token — that is what cloud accounts
 * stage B established, and the reason a dead calendar token can no longer sit
 * next to a healthy file sync. The phone's connect run would have undone it:
 * signing each service in on its own screen means each one opens its own
 * consent and keeps its own refresh token, which is exactly the arrangement
 * stage B removed.
 *
 * So the FIRST OAuth service of a run asks for the union of the scopes the run
 * covers, and the token it brings back becomes the account-wide one. The
 * services after it then need no consent at all: the broker already serves
 * files (`switchProviderToAccountBroker`) and calendar (`pimAuth` probes it
 * before its own credentials).
 *
 * Mail is the honest exception and stays on its own consent: `graphMail` can
 * run on a broker, but no shell registers a mail token resolver — on either
 * platform. Widening the consent without a consumer would ask for permissions
 * nobody uses. A Microsoft account with all three services therefore costs two
 * consents rather than three; Google's files+calendar costs one instead of two
 * (Gmail runs on an app password and never enters an OAuth consent at all).
 */

/** Families whose services share one account token. */
export type BrokerFamily = "google" | "microsoft";

export function brokerFamilyOf(family: CloudProviderFamily): BrokerFamily | null {
  return family === "google" || family === "microsoft" ? family : null;
}

/**
 * The services of a run that a single OAuth consent can cover.
 *
 * Gmail is excluded for Google because it signs in with an app password;
 * Microsoft mail is excluded because nothing reads a broker token for it yet.
 * Both exclusions are about what the token would actually be USED for — asking
 * for a scope with no consumer is a broader consent for nothing.
 */
export function consentServicesOf(family: BrokerFamily, services: readonly CloudServiceId[]): CloudServiceId[] {
  const carried = FAMILY_SERVICES[family];
  return services.filter((s) => carried.includes(s) && s !== "mail");
}

/**
 * The scope the first consent of this run should ask for, or null when one
 * service is all the run covers — then the provider default is exactly right
 * and a widened consent would be permission creep.
 */
export function runConsentScope(family: CloudProviderFamily, services: readonly CloudServiceId[]): string | null {
  const broker = brokerFamilyOf(family);
  if (!broker) return null;
  const covered = consentServicesOf(broker, services);
  return covered.length >= 2 ? unionScopeFor(broker, covered) : null;
}

/**
 * Whether the service in front of the run can be connected WITHOUT its own
 * consent, because the account token from the first one already covers it.
 */
export function canSkipConsent(
  family: CloudProviderFamily,
  services: readonly CloudServiceId[],
  service: CloudServiceId,
  hasAccountToken: boolean,
): boolean {
  if (!hasAccountToken) return false;
  const broker = brokerFamilyOf(family);
  if (!broker) return false;
  return consentServicesOf(broker, services).includes(service);
}

/**
 * Moves the run's widened token into the ACCOUNT slot, so the services after
 * the first one refresh through the broker instead of asking for a consent of
 * their own.
 *
 * Runs after the first service connected, because only then does a registry
 * record — and therefore an account id to key the slot on — exist. That is the
 * obstacle this step had to get past: `beginAccountLogin` has always needed a
 * `CloudAccountRecord`, and at first connect there is none yet.
 *
 * Order matters and mirrors `accountLogin`: the account slot is written FIRST,
 * so a failure while handing the file sync over leaves a working account either
 * way. Returns the account it bound to, or null when there was nothing to bind.
 */
export async function bindRunTokenToAccount(
  vaultId: string,
  family: CloudProviderFamily,
  services: readonly CloudServiceId[],
): Promise<string | null> {
  const broker = brokerFamilyOf(family);
  if (!broker) return null;
  const covered = consentServicesOf(broker, services);
  if (covered.length < 2) return null;

  const provider = await getStoredProvider(vaultId);
  if (!provider || (provider.provider !== "drive" && provider.provider !== "onedrive")) return null;
  const creds = provider.creds as {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    grantedScope?: string;
  };
  if (!creds.refreshToken || !creds.clientId) return null;

  const records = await loadCloudAccounts(vaultId);
  const record = records.find((r) => r.family === family && r.services.files);
  if (!record) return null;
  if ((await getAccountToken(vaultId, record.id))?.refreshToken) return null;

  // Record what the consent GRANTED, never what the run asked for. Storing the
  // request made a Drive-only token claim the calendar, and Google cannot widen
  // a grant on refresh — so every calendar read failed with a 401 that looked
  // like a revoked sign-in (finding 2026-08-19). A token from before this fix
  // carries no grant, and "unknown" must read as "no": `tokenCoversService`
  // treats a Google token without scopes as not covering anything, which sends
  // the service to its own consent instead of a dead shared one.
  const granted = creds.grantedScope?.trim();
  await saveAccountToken(vaultId, record.id, {
    clientId: creds.clientId,
    ...(creds.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    refreshToken: creds.refreshToken,
    ...(granted ? { scopes: granted } : {}),
  });
  await switchProviderToAccountBroker(vaultId);
  return record.id;
}
