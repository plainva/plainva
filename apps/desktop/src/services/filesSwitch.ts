import { bindSyncState, isServiceOff, type SyncStateBinding, type SyncStateBindingDecision, type VerifiedProviderIdentity } from "@plainva/ui";
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
  return (await filesOffForVault(vaultPath)) || isSyncPausedHere(vaultPath);
}

/** Files switched off for the vault (E3) - on every device, carried in the settings profile. */
export async function filesOffForVault(vaultPath: string): Promise<boolean> {
  const records = await loadCloudAccounts(vaultPath).catch(() => []);
  return records.some((record) => record.services.files && isServiceOff(record, "files"));
}

/** The account card that carries the vault's files through `provider`, where it signs in on this device (third review, finding 3). */
export async function filesAccountIdForVault(vaultPath: string, provider: string): Promise<string | undefined> {
  const records = await loadCloudAccounts(vaultPath).catch(() => []);
  return records.find((record) => record.services.files?.provider === provider)?.id;
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

/**
 * The target the vault's sync queue and per-file records belong to, on this
 * device (third review of plan "Verbinden", finding 1). Checked right before
 * the file sync worker is built: the same target keeps both, another drops
 * both - removing an account clears nothing, so connecting the same folder
 * again finds its records and makes no conflict copies.
 */
export const syncStateBindingKey = (vaultPath: string) =>
  `syncStateBinding_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function bindVaultSyncState(
  vaultPath: string,
  current: SyncStateBinding,
  state: { queue: { clearAll(): Promise<void> }; records: { clearAll(): Promise<void> } },
): Promise<SyncStateBindingDecision> {
  const store = await getSettingsStore();
  return bindSyncState({
    load: async () => (await store.get<SyncStateBinding>(syncStateBindingKey(vaultPath))) ?? null,
    save: async (binding) => { await store.set(syncStateBindingKey(vaultPath), binding); await store.save(); },
    clear: async () => { await state.queue.clearAll(); await state.records.clearAll(); },
  }, current);
}

/** The account the vault's files card proved, where it has one. */
export async function filesIdentityForVault(vaultPath: string, provider: string): Promise<VerifiedProviderIdentity | undefined> {
  const records = await loadCloudAccounts(vaultPath).catch(() => []);
  return records.find((record) => record.services.files?.provider === provider)?.verifiedProviderIdentity;
}
