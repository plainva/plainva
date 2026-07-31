import {
  accountRepairBindingKey,
  executeAccountRepair,
  getPlatformServices,
  normalizeAccountMap,
  recoverAccountRepair,
  type AccountRepairJournal,
  type AccountRepairNeed,
  type AccountRepairPorts,
  type ProfileAccountMap,
} from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { getAccountToken } from "./accountBroker";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { getPimCredentials } from "./pim/pimCredentials";

export const accountRepairJournalKey = (vaultId: string) => `accountRepairJournalMobile_${vaultId}`;
export const accountRepairNeedsKey = (vaultId: string) => `accountRepairNeedsMobile_${vaultId}`;

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

export async function recoverMobileAccountRepair(vaultId: string, accountMapKey: string): Promise<boolean> {
  return recoverAccountRepair(mobileAccountRepairPorts(vaultId, accountMapKey));
}
