import { confirmationEndpoint, isEndpointConfirmedIn, isSignedOutSlot } from "@plainva/ui";
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
 * this phone has not confirmed (F57): the password stays here and the card
 * asks to confirm the address. One place for both, so no target is built
 * around it (review of F57, O4).
 */
export async function pimTargetCredentials(vaultId: string, accountId: string): Promise<PimStoredCredentials | null> {
  const creds = await getPimCredentials(vaultId, accountId);
  if (!creds || isSignedOutSlot(creds)) return null;
  if (creds.kind === "caldav" && !(await isEndpointConfirmedIn(vaultId, confirmationEndpoint(creds.url)))) return null;
  return creds;
}
