import { normalizeAccountMap, type ProfileAccountMap } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";

/**
 * Where the desktop keeps a vault's account map (local id <-> shared id, and
 * the accounts removed here). Its own module, so the card registry can read
 * it without importing the settings sync that imports the registry.
 */
const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
export const profileAccountMapKey = (vaultPath: string) => `settingsSyncAccountMap_${b64(vaultPath)}`;

export async function loadProfileAccountMap(vaultPath: string): Promise<ProfileAccountMap> {
  const store = await getSettingsStore();
  return normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath)));
}
