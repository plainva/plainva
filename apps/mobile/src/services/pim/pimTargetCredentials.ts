import { isSignedOutSlot } from "@plainva/ui";
import { getPimCredentials, type PimStoredCredentials } from "./pimCredentials";

/**
 * The credentials a calendar target may be built with - none for an account
 * signed out on this phone (review of plan "Verbinden", finding 3). Without
 * this the worker kept asking the provider with an emptied password every
 * cycle, which iCloud and Nextcloud answer with a lockout. A CalDAV server set
 * up without a password still gets its target; only the sign-out mark stops it.
 * The desktop applies the same rule in `pim/pimRuntime.ts` (`buildTarget`).
 */
export async function pimTargetCredentials(vaultId: string, accountId: string): Promise<PimStoredCredentials | null> {
  const creds = await getPimCredentials(vaultId, accountId);
  return !creds || isSignedOutSlot(creds) ? null : creds;
}
