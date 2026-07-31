import {
  accountRepairBindingKey,
  executeAccountRepair,
  normalizeAccountMap,
  recoverAccountRepair,
  type AccountRepairJournal,
  type AccountRepairNeed,
  type AccountRepairPorts,
  type CloudAccountRecord,
  type ISettingsStore,
  type ProfileAccountMap,
} from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { getAccountToken } from "./accountBroker";
import { cloudAccountsRegistryKey } from "./cloudAccounts";
import { credentialManager } from "./CredentialManager";
import { getPimCredentials } from "./pim/pimCredentials";

const b64 = (value: string) => btoa(unescape(encodeURIComponent(value)));

export const accountRepairJournalKey = (vaultPath: string) => `accountRepairJournal_${b64(vaultPath)}`;
export const accountRepairNeedsKey = (vaultPath: string) => `accountRepairNeeds_${b64(vaultPath)}`;

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

export async function recoverDesktopAccountRepair(
  store: ISettingsStore,
  vaultPath: string,
  profileAccountMapKey: string,
): Promise<boolean> {
  return recoverAccountRepair(desktopAccountRepairPorts(store, vaultPath, profileAccountMapKey));
}
