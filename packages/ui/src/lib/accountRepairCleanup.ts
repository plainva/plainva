import type {
  IDatabaseAdapter,
  PimAccountCacheSnapshot,
  PimCacheRepository,
} from "@plainva/core";
import type { ICredentialStore } from "../platform/credentials.js";
import type { ISettingsStore } from "../platform/settings.js";
import {
  forgetCachedMail,
  restoreCachedMail,
  snapshotCachedMail,
  type MailCacheSnapshot,
} from "../mail/mailCache.js";
import type { MailAccountConfig } from "../mail/mailAccounts.js";
import type { AccountRepairCleanup } from "./accountRepair.js";

export interface AccountRepairCleanupJournal {
  version: 1;
  state: "prepared" | "cleaned";
  backupSlot: string;
  cleanup: AccountRepairCleanup;
  pim: PimAccountCacheSnapshot[];
  mailCache: MailCacheSnapshot[];
  mailAccounts: MailAccountConfig[];
}

interface AccountRepairSecretBackup {
  version: 1;
  entries: Array<{ slot: string; value: unknown | null }>;
}

export interface AccountRepairCleanupResources {
  store: ISettingsStore;
  credentials: ICredentialStore;
  journalKey: string;
  backupSlot: string;
  pimCache: PimCacheRepository | null;
  db: IDatabaseAdapter | null;
  listMailAccounts(): Promise<MailAccountConfig[]>;
  replaceMailAccounts(accounts: MailAccountConfig[]): Promise<void>;
  accountSecretSlot(accountId: string): string;
  pimSecretSlot(accountId: string): string;
  mailSecretSlot(accountId: string): string;
}

async function persistJournal(
  resources: AccountRepairCleanupResources,
  journal: AccountRepairCleanupJournal,
): Promise<void> {
  await resources.store.set(resources.journalKey, journal);
  await resources.store.save();
}

async function clearJournal(resources: AccountRepairCleanupResources): Promise<void> {
  await resources.store.delete(resources.journalKey);
  await resources.store.save();
}

function secretSlots(resources: AccountRepairCleanupResources, cleanup: AccountRepairCleanup): string[] {
  return [...new Set([
    resources.accountSecretSlot(cleanup.targetAccountId),
    ...cleanup.accountIds.map(resources.accountSecretSlot),
    ...cleanup.pimAccountIds.map(resources.pimSecretSlot),
    ...cleanup.mailAccountIds.map(resources.mailSecretSlot),
  ])];
}

async function restorePrepared(
  resources: AccountRepairCleanupResources,
  journal: AccountRepairCleanupJournal,
): Promise<void> {
  await resources.replaceMailAccounts(journal.mailAccounts);
  if (resources.pimCache) {
    for (const snapshot of journal.pim) await resources.pimCache.restoreAccount(snapshot);
  }
  if (resources.db) {
    for (const snapshot of journal.mailCache) await restoreCachedMail(resources.db, snapshot);
  }
  const backup = await resources.credentials
    .readSecret<AccountRepairSecretBackup>(journal.backupSlot)
    .catch(() => null);
  if (!backup || backup.version !== 1) throw new Error("account-repair-secret-backup-missing");
  for (const entry of backup.entries) {
    if (entry.value === null) await resources.credentials.removeSecret(entry.slot);
    else await resources.credentials.writeSecret(entry.slot, entry.value);
  }
}

/**
 * Recovers a cleanup interrupted after its durable preparation. A journal
 * marked `cleaned` represents a committed cleanup and is only finalized.
 */
export async function recoverAccountRepairCleanup(
  resources: AccountRepairCleanupResources,
): Promise<boolean> {
  const journal = await resources.store.get<AccountRepairCleanupJournal>(resources.journalKey);
  if (!journal || journal.version !== 1) return false;
  if (
    journal.state === "prepared"
    && ((journal.pim.length > 0 && !resources.pimCache)
      || (journal.mailCache.length > 0 && !resources.db))
  ) {
    return false;
  }
  if (journal.state === "prepared") await restorePrepared(resources, journal);
  await clearJournal(resources);
  await resources.credentials.removeSecret(journal.backupSlot).catch(() => undefined);
  return true;
}

/**
 * Removes only orphaned subsystem rows and slots from a confirmed guided merge.
 *
 * Secret payloads live solely in a temporary credential-store slot. Cached
 * content and non-secret account metadata stay in a device-local journal and
 * never enter the shared profile or diagnostics.
 */
export async function cleanupRepairedAccount(
  resources: AccountRepairCleanupResources,
  cleanup: AccountRepairCleanup,
): Promise<void> {
  await recoverAccountRepairCleanup(resources);
  const mailAccounts = await resources.listMailAccounts();
  const pim = resources.pimCache
    ? await Promise.all(cleanup.pimAccountIds.map((id) => resources.pimCache!.snapshotAccount(id)))
    : [];
  const mailCache = resources.db
    ? await Promise.all(cleanup.mailAccountIds.map((id) => snapshotCachedMail(resources.db, id)))
    : [];
  const slots = secretSlots(resources, cleanup);
  const entries: AccountRepairSecretBackup["entries"] = [];
  for (const slot of slots) {
    entries.push({
      slot,
      value: await resources.credentials.readSecret<unknown>(slot).catch(() => null),
    });
  }
  await resources.credentials.writeSecret<AccountRepairSecretBackup>(resources.backupSlot, {
    version: 1,
    entries,
  });
  const journal: AccountRepairCleanupJournal = {
    version: 1,
    state: "prepared",
    backupSlot: resources.backupSlot,
    cleanup,
    pim,
    mailCache,
    mailAccounts,
  };
  await persistJournal(resources, journal);

  try {
    const targetSlot = resources.accountSecretSlot(cleanup.targetAccountId);
    const target = entries.find((entry) => entry.slot === targetSlot)?.value ?? null;
    if (target === null) {
      const source = cleanup.accountIds
        .map((id) => entries.find((entry) => entry.slot === resources.accountSecretSlot(id))?.value ?? null)
        .find((value) => value !== null);
      if (source !== undefined) await resources.credentials.writeSecret(targetSlot, source);
    }

    if (resources.pimCache) {
      for (const accountId of cleanup.pimAccountIds) await resources.pimCache.deleteAccount(accountId);
    }
    if (resources.db) {
      for (const accountId of cleanup.mailAccountIds) await forgetCachedMail(resources.db, accountId);
    }
    if (cleanup.mailAccountIds.length > 0) {
      const removed = new Set(cleanup.mailAccountIds);
      await resources.replaceMailAccounts(mailAccounts.filter((account) => !removed.has(account.id)));
    }
    for (const accountId of cleanup.accountIds) {
      await resources.credentials.removeSecret(resources.accountSecretSlot(accountId));
    }
    for (const accountId of cleanup.pimAccountIds) {
      await resources.credentials.removeSecret(resources.pimSecretSlot(accountId));
    }
    for (const accountId of cleanup.mailAccountIds) {
      await resources.credentials.removeSecret(resources.mailSecretSlot(accountId));
    }

    journal.state = "cleaned";
    await persistJournal(resources, journal);
    await clearJournal(resources);
    await resources.credentials.removeSecret(resources.backupSlot).catch(() => undefined);
  } catch (error) {
    try {
      await restorePrepared(resources, journal);
      await clearJournal(resources);
      await resources.credentials.removeSecret(resources.backupSlot).catch(() => undefined);
    } catch {
      // Keep both durable journals for startup recovery; neither is logged.
    }
    throw error;
  }
}
