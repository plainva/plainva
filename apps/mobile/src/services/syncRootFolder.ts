import { getPlatformServices } from "@plainva/ui";
import type { MobileSyncProvider } from "./syncSlot";

/**
 * Where the vault's remote folder lives — the settings, not the credentials
 * (mobile counterpart of the desktop's syncRootFolder, finding 2026-08-19).
 *
 * It used to be a FIELD OF THE CREDENTIALS. No secret, but in the secret slot,
 * and a removed account took it along: the sync target then fell back to its
 * built-in default AND CREATED THAT FOLDER, so the vault synced into a fresh,
 * empty remote while the real one sat untouched beside it.
 *
 * Only the three OAuth providers move. WebDAV keeps its URL and S3 its prefix
 * in the credentials on purpose: there the folder is part of the connection
 * itself and visible in the form on every reconnect, so it cannot be lost
 * silently.
 *
 * Deliberately NOT part of the settings profile: which service a device syncs
 * through is a device decision, and a second device on another provider must
 * not overwrite this.
 */

const STORE_PROVIDERS = new Set(["drive", "onedrive", "dropbox"]);

export const syncRootFolderKey = (vaultId: string, provider: string) => `syncRootFolder_${provider}_${vaultId}`;

/** The value still sitting in the credential blob, if one is left. */
function folderFromCredentials(stored: MobileSyncProvider | null): string {
  if (!stored) return "";
  const creds = stored.creds as { rootFolderName?: string; rootPath?: string; prefix?: string };
  if (stored.provider === "drive" || stored.provider === "onedrive") return creds.rootFolderName ?? "";
  if (stored.provider === "dropbox") return creds.rootPath ?? "";
  if (stored.provider === "s3") return creds.prefix ?? "";
  return "";
}

/**
 * Read-through migration: the store wins, and the old blob value is carried
 * over the first time it is read.
 *
 * The check is `typeof === "string"`, not truthy: an explicitly emptied folder
 * is a DECISION ("use the default") and must not be overwritten from the blob
 * again on the next read. The blob value itself is never deleted — it simply
 * goes stale and dies with the slot.
 */
export async function readSyncRootFolder(
  vaultId: string,
  provider: string,
  stored: MobileSyncProvider | null,
): Promise<string> {
  if (!STORE_PROVIDERS.has(provider)) return folderFromCredentials(stored);
  const store = await getPlatformServices().loadSettings();
  const fromStore = await store.get<string>(syncRootFolderKey(vaultId, provider));
  if (typeof fromStore === "string") return fromStore;

  const legacy = folderFromCredentials(stored);
  if (legacy) await writeSyncRootFolder(vaultId, provider, legacy);
  return legacy;
}

export async function writeSyncRootFolder(vaultId: string, provider: string, value: string): Promise<void> {
  if (!STORE_PROVIDERS.has(provider)) return;
  const store = await getPlatformServices().loadSettings();
  await store.set(syncRootFolderKey(vaultId, provider), value);
  await store.save();
}

/** Called when a vault is forgotten — the key is per vault AND per provider. */
export async function clearSyncRootFolders(vaultId: string): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  for (const provider of STORE_PROVIDERS) await store.delete(syncRootFolderKey(vaultId, provider));
  await store.save();
}
