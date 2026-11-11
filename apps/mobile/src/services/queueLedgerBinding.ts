import { connectionFingerprint } from "@plainva/core";
import { remoteRoot } from "./mobileSettingsSync";
import { getStoredProvider } from "./syncService";

/**
 * The remote a vault's sync entries are meant for (stability plan R5): the
 * provider and its root folder, as the settings sync names a connection
 * (`connectionFingerprint`). A queue ledger written for one is never replayed
 * into another — the sync moved to another folder while the database stayed
 * closed. Null for a vault without a sync: there is nobody to tell of a
 * deletion, and nothing is recorded.
 */
export async function ledgerBinding(vaultId: string): Promise<string | null> {
  const provider = await getStoredProvider(vaultId);
  if (!provider) return null;
  return connectionFingerprint(provider.provider, await remoteRoot(vaultId, provider));
}
