import { getPlatformServices, normalizeAccountMap, type ProfileAccountMap } from "@plainva/ui";

/**
 * The account map lives beside the profile: it ties a device-local account id
 * to the id used in the shared document, so the same account is recognised
 * across devices even though the ids differ (they end up in keychain slots),
 * and it holds the accounts removed here. Its own module, so the card registry
 * can read it without importing the settings sync that imports the registry.
 */
export const accountMapKey = (vaultId: string) => `settingsSyncAccountMapMobile_${vaultId}`;

export async function loadProfileAccountMap(vaultId: string): Promise<ProfileAccountMap> {
  const store = await getPlatformServices().loadSettings();
  return normalizeAccountMap(await store.get<ProfileAccountMap>(accountMapKey(vaultId)));
}
