import { assertEndpointConfirmedIn, confirmationEndpoint, isEndpointConfirmedIn, isSignedOutSlot } from "@plainva/ui";
import { getPimCredentials, type PimStoredCredentials } from "./pimCredentials";

/**
 * The credentials a calendar target may be built with - none for an account
 * signed out on this phone (review of plan "Verbinden", finding 3). Without
 * this the worker kept asking the provider with an emptied password every
 * cycle, which iCloud and Nextcloud answer with a lockout. A CalDAV server set
 * up without a password still gets its target; only the sign-out mark stops it.
 * The desktop applies the same rule in `pim/pimRuntime.ts` (`buildTarget`).
 *
 * None either for a CalDAV address without TLS or in a private network that
 * this phone has not confirmed (F57): the password stays here. One place, so
 * no target is built around it (review of F57, O4); the sync and "Check
 * connection" are told why (`refuseUnconfirmedCalendar`).
 */
export async function pimTargetCredentials(vaultId: string, accountId: string): Promise<PimStoredCredentials | null> {
  const creds = await getPimCredentials(vaultId, accountId);
  if (!creds || isSignedOutSlot(creds)) return null;
  if (creds.kind === "caldav" && !(await isEndpointConfirmedIn(vaultId, confirmationEndpoint(creds.url)))) return null;
  return creds;
}

/**
 * For the sync and "Check connection": a CalDAV address this phone has not
 * confirmed is refused with its name instead of no target, so the account
 * waits visibly - the calendar's notice, the account's row and the check say
 * Confirm address (review of F57, O-5).
 */
export async function refuseUnconfirmedCalendar(vaultId: string, accountId: string): Promise<void> {
  const creds = await getPimCredentials(vaultId, accountId);
  if (creds?.kind === "caldav" && !isSignedOutSlot(creds)) await assertEndpointConfirmedIn(vaultId, confirmationEndpoint(creds.url));
}

/** A target builder for the sync and "Check connection": `build`, after `refuseUnconfirmedCalendar` for a CalDAV account. */
export function refusingUnconfirmed<A extends { id: string; provider: string }, T>(build: (vaultId: string, account: A) => Promise<T | null>): (vaultId: string, account: A) => Promise<T | null> {
  return async (vaultId, account) => {
    if (account.provider === "caldav") await refuseUnconfirmedCalendar(vaultId, account.id);
    return build(vaultId, account);
  };
}
