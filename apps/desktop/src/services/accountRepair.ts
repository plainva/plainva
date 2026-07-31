import {
  accountRepairBindingKey,
  cleanupRepairedAccount,
  executeAccountRepair,
  executeGuidedAccountRepair,
  normalizeAccountMap,
  recoverAccountRepair,
  recoverAccountRepairCleanup,
  type AccountRepairJournal,
  type AccountRepairCleanupResources,
  type AccountRepairNeed,
  type AccountRepairPorts,
  type CloudAccountRecord,
  type GuidedAccountRepairPlan,
  type GuidedAccountRepairResult,
  type GuidedAccountRepairSelection,
  type ISettingsStore,
  type ProfileAccountMap,
} from "@plainva/ui";
import type { IDatabaseAdapter, PimCacheRepository } from "@plainva/core";
import {
  listMailAccounts,
  mailSecretKey,
  replaceMailAccounts,
} from "@plainva/ui/mail";
import { accountSecretKey, getAccountToken } from "./accountBroker";
import { cloudAccountsRegistryKey } from "./cloudAccounts";
import { credentialManager } from "./CredentialManager";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";

const b64 = (value: string) => btoa(unescape(encodeURIComponent(value)));

export const accountRepairJournalKey = (vaultPath: string) => `accountRepairJournal_${b64(vaultPath)}`;
export const accountRepairNeedsKey = (vaultPath: string) => `accountRepairNeeds_${b64(vaultPath)}`;
export const accountRepairCleanupJournalKey = (vaultPath: string) => `accountRepairCleanup_${b64(vaultPath)}`;
export const accountRepairMapKey = (vaultPath: string) => `settingsSyncAccountMap_${b64(vaultPath)}`;
const accountRepairBackupSlot = (vaultPath: string) => `account_repair_backup_${b64(vaultPath)}`;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

async function usableFileBinding(
  vaultPath: string,
  provider: NonNullable<CloudAccountRecord["services"]["files"]>["provider"],
): Promise<boolean> {
  if (provider === "drive") return hasText((await credentialManager.getDriveCredentials(vaultPath))?.refreshToken);
  if (provider === "onedrive") return hasText((await credentialManager.getOneDriveCredentials(vaultPath))?.refreshToken);
  if (provider === "dropbox") return hasText((await credentialManager.getDropboxCredentials(vaultPath))?.refreshToken);
  if (provider === "s3") return !!(await credentialManager.getS3Credentials(vaultPath));
  return !!(await credentialManager.getWebDavCredentials(vaultPath));
}

export function desktopAccountRepairPorts(
  store: ISettingsStore,
  vaultPath: string,
  profileAccountMapKey: string,
): AccountRepairPorts {
  const loadAccounts = async () => {
    const value = await store.get<CloudAccountRecord[]>(cloudAccountsRegistryKey(vaultPath));
    return Array.isArray(value) ? value : [];
  };
  const persist = async (key: string, value: unknown) => {
    await store.set(key, value);
    await store.save();
  };
  return {
    listAccounts: loadAccounts,
    replaceAccounts: (accounts) => persist(cloudAccountsRegistryKey(vaultPath), accounts),
    loadAccountMap: async () => normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey)),
    saveAccountMap: (map) => persist(profileAccountMapKey, map),
    usableBindings: async () => {
      const bindings = new Set<string>();
      for (const account of await loadAccounts()) {
        const token = await getAccountToken(vaultPath, account.id).catch(() => null);
        if (hasText(token?.refreshToken)) {
          bindings.add(accountRepairBindingKey("account", account.id));
        }
        const calendarId = account.services.calendar?.pimAccountId;
        if (calendarId) {
          const credentials = await getPimCredentials(vaultPath, calendarId).catch(() => null);
          if (
            (credentials?.kind === "caldav" && hasText(credentials.pass))
            || (credentials?.kind !== "caldav" && hasText(credentials?.refreshToken))
          ) {
            bindings.add(accountRepairBindingKey("pim", calendarId));
          }
        }
        const mailId = account.services.mail?.mailAccountId;
        if (mailId) {
          const credentials = await credentialManager
            .readSecret<{ pass?: string; refreshToken?: string }>(mailSecretKey(vaultPath, mailId))
            .catch(() => null);
          if (hasText(credentials?.pass) || hasText(credentials?.refreshToken)) {
            bindings.add(accountRepairBindingKey("mail", mailId));
          }
        }
        const provider = account.services.files?.provider;
        if (provider && await usableFileBinding(vaultPath, provider).catch(() => false)) {
          bindings.add(accountRepairBindingKey("files", provider));
        }
      }
      return [...bindings];
    },
    loadJournal: async () => (await store.get<AccountRepairJournal>(accountRepairJournalKey(vaultPath))) ?? null,
    saveJournal: (journal) => persist(accountRepairJournalKey(vaultPath), journal),
    clearJournal: async () => {
      await store.delete(accountRepairJournalKey(vaultPath));
      await store.save();
    },
    loadNeedsReview: async () => (await store.get<AccountRepairNeed[]>(accountRepairNeedsKey(vaultPath))) ?? [],
    saveNeedsReview: (needs) => persist(accountRepairNeedsKey(vaultPath), needs),
  };
}

export async function repairDesktopAccounts(
  store: ISettingsStore,
  vaultPath: string,
  profileAccountMapKey: string,
) {
  return executeAccountRepair(desktopAccountRepairPorts(store, vaultPath, profileAccountMapKey));
}

function desktopCleanupResources(
  store: ISettingsStore,
  vaultPath: string,
  pimCache: PimCacheRepository | null,
  db: IDatabaseAdapter | null,
): AccountRepairCleanupResources {
  return {
    store,
    credentials: credentialManager,
    journalKey: accountRepairCleanupJournalKey(vaultPath),
    backupSlot: accountRepairBackupSlot(vaultPath),
    pimCache,
    db,
    listMailAccounts: () => listMailAccounts(vaultPath),
    replaceMailAccounts: (accounts) => replaceMailAccounts(vaultPath, accounts),
    accountSecretSlot: (accountId) => accountSecretKey(vaultPath, accountId),
    pimSecretSlot: (accountId) => pimSecretKey(vaultPath, accountId),
    mailSecretSlot: (accountId) => mailSecretKey(vaultPath, accountId),
  };
}

export async function loadDesktopAccountRepairNeeds(
  store: ISettingsStore,
  vaultPath: string,
): Promise<AccountRepairNeed[]> {
  return (await store.get<AccountRepairNeed[]>(accountRepairNeedsKey(vaultPath))) ?? [];
}

export async function guideDesktopAccountRepair(
  store: ISettingsStore,
  vaultPath: string,
  selection: GuidedAccountRepairSelection,
  confirm: (plan: GuidedAccountRepairPlan) => Promise<boolean>,
  pimCache: PimCacheRepository | null,
  db: IDatabaseAdapter | null,
): Promise<GuidedAccountRepairResult> {
  const resources = desktopCleanupResources(store, vaultPath, pimCache, db);
  await recoverAccountRepairCleanup(resources);
  return executeGuidedAccountRepair(
    desktopAccountRepairPorts(store, vaultPath, accountRepairMapKey(vaultPath)),
    selection,
    confirm,
    (cleanup) => cleanupRepairedAccount(resources, cleanup),
  );
}

export async function recoverDesktopAccountRepair(
  store: ISettingsStore,
  vaultPath: string,
  profileAccountMapKey: string,
  pimCache: PimCacheRepository | null = null,
  db: IDatabaseAdapter | null = null,
): Promise<boolean> {
  const cleanupRecovered = await recoverAccountRepairCleanup(
    desktopCleanupResources(store, vaultPath, pimCache, db),
  );
  const repairRecovered = await recoverAccountRepair(
    desktopAccountRepairPorts(store, vaultPath, profileAccountMapKey),
  );
  return cleanupRecovered || repairRecovered;
}
