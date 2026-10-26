import { calendarSwitches } from "@plainva/ui";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { listPimAccounts, setPimAccountEnabled } from "./pim/pimService";
import { notifyMailChanged } from "./mail/mailRuntime";

/** The calendar half alone - at every start of the calendar runtime, without touching the file sync. */
export async function applyCalendarSwitches(vaultId: string): Promise<void> {
  const records = await loadCloudAccounts(vaultId);
  for (const { row, enabled } of calendarSwitches(records, await listPimAccounts())) await setPimAccountEnabled(row.id, enabled);
}

/**
 * The account switches of the vault (plan "Verbinden", E3), applied on this
 * phone: a calendar switched off stops here too - its cache stays -, the file
 * sync of a vault whose files are off stands still, a switched-off mailbox is
 * not read. Called after a switch here and when the vault's records arrive.
 */
export async function applyMobileServiceSwitches(vaultId: string): Promise<void> {
  await applyCalendarSwitches(vaultId);
  const { getActiveVaultEntry } = await import("./vaultRegistry");
  if ((await getActiveVaultEntry()).id === vaultId) {
    const { startSyncIfConfigured, stopSyncAndDrain } = await import("./syncService");
    const { getMobileVault } = await import("./vaultService");
    await stopSyncAndDrain();
    await startSyncIfConfigured(await getMobileVault());
  }
  notifyMailChanged();
}
