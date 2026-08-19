import {
  accountRepairBindingKey,
  cleanupRepairedAccount,
  executeAccountRepair,
  executeGuidedAccountRepair,
  getPlatformServices,
  normalizeAccountMap,
  recoverAccountRepair,
  recoverAccountRepairCleanup,
  type AccountRepairCleanupResources,
  type AccountRepairJournal,
  type AccountRepairNeed,
  type AccountRepairPorts,
  type GuidedAccountRepairPlan,
  type GuidedAccountRepairResult,
  type GuidedAccountRepairSelection,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import { PimCacheRepository, type IDatabaseAdapter } from "@plainva/core";
import {
  listMailAccounts,
  mailSecretKey,
  replaceMailAccounts,
} from "@plainva/ui/mail";
import { accountSecretKey, getAccountToken } from "./accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { filesViaBrokerToken, readStoredProvider, resolveMobileFileAccess } from "./fileSyncAccess";

export const accountRepairJournalKey = (vaultId: string) => `accountRepairJournalMobile_${vaultId}`;
export const accountRepairNeedsKey = (vaultId: string) => `accountRepairNeedsMobile_${vaultId}`;
export const accountRepairCleanupJournalKey = (vaultId: string) => `accountRepairCleanupMobile_${vaultId}`;
export const accountRepairMapKey = (vaultId: string) => `settingsSyncAccountMapMobile_${vaultId}`;
const accountRepairBackupSlot = (vaultId: string) => `account_repair_backup_mobile_${vaultId}`;

/** Whether this device can actually open the vault's file connection. */
async function usableFileBinding(
  vaultId: string,
  provider: NonNullable<CloudAccountRecord["services"]["files"]>["provider"],
): Promise<boolean> {
  const stored = await readStoredProvider(vaultId);
  const viaBroker = await filesViaBrokerToken(vaultId, provider);
  return resolveMobileFileAccess(provider, stored, viaBroker).ready;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

export function mobileAccountRepairPorts(vaultId: string, accountMapKey: string): AccountRepairPorts {
  const settings = () => getPlatformServices().loadSettings();
  const persist = async (key: string, value: unknown) => {
    const store = await settings();
    await store.set(key, value);
    await store.save();
  };
  return {
    listAccounts: () => loadCloudAccounts(vaultId),
    replaceAccounts: (accounts) => saveCloudAccounts(vaultId, accounts),
    loadAccountMap: async () => normalizeAccountMap(
      await (await settings()).get<ProfileAccountMap>(accountMapKey),
    ),
    saveAccountMap: (map) => persist(accountMapKey, map),
    usableBindings: async () => {
      const bindings = new Set<string>();
      for (const account of await loadCloudAccounts(vaultId)) {
        const token = await getAccountToken(vaultId, account.id).catch(() => null);
        if (hasText(token?.refreshToken)) {
          bindings.add(accountRepairBindingKey("account", account.id));
        }
        const calendarId = account.services.calendar?.pimAccountId;
        if (calendarId) {
          const credentials = await getPimCredentials(vaultId, calendarId).catch(() => null);
          if (
            (credentials?.kind === "caldav" && hasText(credentials.pass))
            || (credentials?.kind !== "caldav" && hasText(credentials?.refreshToken))
          ) {
            bindings.add(accountRepairBindingKey("pim", calendarId));
          }
        }
        const mailId = account.services.mail?.mailAccountId;
        if (mailId) {
          const credentials = await getPlatformServices().credentials
            .readSecret<{ pass?: string; refreshToken?: string }>(mailSecretKey(vaultId, mailId))
            .catch(() => null);
          if (hasText(credentials?.pass) || hasText(credentials?.refreshToken)) {
            bindings.add(accountRepairBindingKey("mail", mailId));
          }
        }
        // The file connection counts too (finding 2026-08-19): without it the
        // merge could never find a candidate that HOLDS the files service, so
        // it was free to hand that service to a record this device cannot open.
        // The desktop has counted it since the repair flow existed.
        const filesProvider = account.services.files?.provider;
        if (filesProvider && (await usableFileBinding(vaultId, filesProvider).catch(() => false))) {
          bindings.add(accountRepairBindingKey("files", filesProvider));
        }
      }
      return [...bindings];
    },
    loadJournal: async () => (
      await (await settings()).get<AccountRepairJournal>(accountRepairJournalKey(vaultId))
    ) ?? null,
    saveJournal: (journal) => persist(accountRepairJournalKey(vaultId), journal),
    clearJournal: async () => {
      const store = await settings();
      await store.delete(accountRepairJournalKey(vaultId));
      await store.save();
    },
    loadNeedsReview: async () => (
      await (await settings()).get<AccountRepairNeed[]>(accountRepairNeedsKey(vaultId))
    ) ?? [],
    saveNeedsReview: (needs) => persist(accountRepairNeedsKey(vaultId), needs),
  };
}

export async function repairMobileAccounts(vaultId: string, accountMapKey: string) {
  return executeAccountRepair(mobileAccountRepairPorts(vaultId, accountMapKey));
}

async function mobileCleanupResources(
  vaultId: string,
  db: IDatabaseAdapter | null,
): Promise<AccountRepairCleanupResources> {
  return {
    store: await getPlatformServices().loadSettings(),
    credentials: getPlatformServices().credentials,
    journalKey: accountRepairCleanupJournalKey(vaultId),
    backupSlot: accountRepairBackupSlot(vaultId),
    pimCache: db ? new PimCacheRepository(db) : null,
    db,
    listMailAccounts: () => listMailAccounts(vaultId),
    replaceMailAccounts: (accounts) => replaceMailAccounts(vaultId, accounts),
    accountSecretSlot: (accountId) => accountSecretKey(vaultId, accountId),
    pimSecretSlot: (accountId) => pimSecretKey(vaultId, accountId),
    mailSecretSlot: (accountId) => mailSecretKey(vaultId, accountId),
  };
}

export async function loadMobileAccountRepairNeeds(vaultId: string): Promise<AccountRepairNeed[]> {
  return (
    await (await getPlatformServices().loadSettings()).get<AccountRepairNeed[]>(
      accountRepairNeedsKey(vaultId),
    )
  ) ?? [];
}

export async function guideMobileAccountRepair(
  vaultId: string,
  selection: GuidedAccountRepairSelection,
  confirm: (plan: GuidedAccountRepairPlan) => Promise<boolean>,
): Promise<GuidedAccountRepairResult> {
  // Dynamic to avoid the vaultService -> mobileSettingsSync -> accountRepair
  // bootstrap cycle; this path is reached only from the already-mounted UI.
  const vault = await (await import("./vaultService")).getMobileVault();
  const db = vault.vaultId === vaultId ? vault.db : null;
  const resources = await mobileCleanupResources(vaultId, db);
  await recoverAccountRepairCleanup(resources);
  return executeGuidedAccountRepair(
    mobileAccountRepairPorts(vaultId, accountRepairMapKey(vaultId)),
    selection,
    confirm,
    (cleanup) => cleanupRepairedAccount(resources, cleanup),
  );
}

export async function recoverMobileAccountRepair(vaultId: string, accountMapKey: string): Promise<boolean> {
  const cleanupRecovered = await recoverAccountRepairCleanup(
    await mobileCleanupResources(vaultId, null),
  );
  const repairRecovered = await recoverAccountRepair(mobileAccountRepairPorts(vaultId, accountMapKey));
  return cleanupRecovered || repairRecovered;
}
