import { isServiceOff } from "@plainva/ui";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSettingsStore } from "./settingsStore";

/**
 * Whether this vault's file sync stands still here (plan "Verbinden", V2/V3):
 * the files service is switched off for the vault (E3, every device), or the
 * sync is paused on THIS device ("Pause sync" on the files page). Either way
 * the vault opens without a sync target and nothing is queued for a push; the
 * slots, the cloud folder and every local file stay.
 */
export const syncPausedKey = (vaultPath: string) =>
  `syncPaused_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function isSyncPausedHere(vaultPath: string): Promise<boolean> {
  return !!(await (await getSettingsStore()).get<boolean>(syncPausedKey(vaultPath)).catch(() => false));
}

export async function setSyncPausedHere(vaultPath: string, paused: boolean): Promise<void> {
  const store = await getSettingsStore();
  if (paused) await store.set(syncPausedKey(vaultPath), true);
  else await store.delete(syncPausedKey(vaultPath));
  await store.save();
}

export async function filesStoppedHere(vaultPath: string): Promise<boolean> {
  const records = await loadCloudAccounts(vaultPath).catch(() => []);
  if (records.some((record) => record.services.files && isServiceOff(record, "files"))) return true;
  return isSyncPausedHere(vaultPath);
}

/**
 * Whether the vault queues its local changes: whenever it has a file provider,
 * running or standing still (review of plan "Verbinden", finding 4). Files
 * switched off, paused here or signed out stop the worker, not the record of
 * what changed - a file edited outside Plainva while files were off went
 * unnoticed by the sync once they were on again, because the index had
 * already taken it in. The queue holds it until the worker runs.
 */
export function queuesLocalChanges(access: { provider: unknown; blocked: unknown }): boolean {
  return access.provider !== null || access.blocked !== null;
}
