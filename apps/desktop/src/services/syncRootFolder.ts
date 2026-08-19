import type { SyncProviderId } from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { getSettingsStore } from "./settingsStore";

/**
 * Where the vault's remote sync folder is configured — and why it no longer
 * lives in the keychain slot.
 *
 * The folder name ("Plainva", "Apps/Plainva", …) used to be a FIELD of the
 * provider credentials. It is not a secret, and keeping it there had one fatal
 * consequence: removing a cloud account wipes the whole slot, so the folder
 * went with it. Reconnecting the same account then found nothing to carry over,
 * `DriveSyncTarget` fell back to its built-in default AND CREATED that folder —
 * and the vault started syncing into a fresh, empty remote while the original
 * one sat untouched (finding 2026-08-19). With the folder field read-only in
 * the UI and the picker broken at the same time, there was no way back.
 *
 * It now lives in the per-vault settings, keyed by provider so re-pointing a
 * vault at a different service keeps both answers.
 *
 * Deliberately NOT part of the synced settings profile: which provider a device
 * uses is a device decision, and a second device syncing through another
 * service must not overwrite this one's folder.
 *
 * WebDAV (the URL) and S3 (bucket + prefix) keep theirs inside the credentials:
 * there they are part of the connection itself, and reconnecting means filling
 * in a form where the value is visible — no silent loss to protect against.
 */

const STORE_PROVIDERS = new Set<SyncProviderId>(["drive", "onedrive", "dropbox"]);

export const syncRootFolderKey = (vaultPath: string, provider: SyncProviderId) =>
  `syncRootFolder_${provider}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** The folder value still held by the provider's credential slot, if any. */
async function folderFromSlot(vaultPath: string, provider: SyncProviderId): Promise<string> {
  if (provider === "drive") return (await credentialManager.getDriveCredentials(vaultPath))?.rootFolderName ?? "";
  if (provider === "onedrive") return (await credentialManager.getOneDriveCredentials(vaultPath))?.rootFolderName ?? "";
  if (provider === "dropbox") return (await credentialManager.getDropboxCredentials(vaultPath))?.rootPath ?? "";
  if (provider === "s3") return (await credentialManager.getS3Credentials(vaultPath))?.prefix ?? "";
  return (await credentialManager.getWebDavCredentials(vaultPath))?.url ?? "";
}

/**
 * Current remote folder of the vault ("" when unset).
 *
 * Migration is a read-through: the first read after the update takes the value
 * still sitting in the slot and writes it to the settings, so an existing vault
 * keeps its folder without anyone touching a dialog. It only runs while the
 * slot still HAS a value — once the account was removed, there is nothing left
 * to rescue, which is exactly the case this whole change exists to prevent.
 */
export async function readSyncRootFolder(vaultPath: string, provider: SyncProviderId): Promise<string> {
  if (!STORE_PROVIDERS.has(provider)) return folderFromSlot(vaultPath, provider);
  const store = await getSettingsStore();
  const stored = await store.get<string>(syncRootFolderKey(vaultPath, provider));
  if (typeof stored === "string") return stored;

  const legacy = await folderFromSlot(vaultPath, provider);
  if (legacy) await writeSyncRootFolder(vaultPath, provider, legacy);
  return legacy;
}

/**
 * Persists the remote folder for this vault + provider.
 *
 * No cleanup counterpart is needed: the key carries the standard per-vault
 * suffix, so "forget this vault" sweeps it with everything else
 * (`vaultForget.ts`).
 */
export async function writeSyncRootFolder(vaultPath: string, provider: SyncProviderId, value: string): Promise<void> {
  if (!STORE_PROVIDERS.has(provider)) return;
  const store = await getSettingsStore();
  await store.set(syncRootFolderKey(vaultPath, provider), value);
  await store.save();
}
