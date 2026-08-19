import { getPlatformServices } from "@plainva/ui";
import { getAccountToken } from "./accountBroker";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { syncProviderSlot, type MobileSyncProvider } from "./syncSlot";

/**
 * One answer to "does THIS device reach the vault's file provider?" — the
 * mobile half of the desktop rule in `apps/desktop/src/services/fileSyncAccess.ts`
 * (findings 2026-07-30 and 2026-08-19, carried over 2026-08-19).
 *
 * The failure it names was invisible by construction: the registry entry knows
 * its provider, so every card said "connected", while the credential slot could
 * be empty — a broker account leaves its own refresh token blank ON PURPOSE
 * (cloud accounts stage B), and a slot the device never received simply is not
 * there. `startSyncIfConfigured` then went to "off" without a word, which is
 * indistinguishable from "no sync set up here".
 *
 * The phone keeps ONE provider slot per vault rather than five, so the question
 * is smaller than on the desktop: does the stored slot match what the registry
 * claims, and does anything on this device open it.
 */

export interface MobileFileSyncAccess {
  /** Everything needed to open the provider is on this device. */
  ready: boolean;
  /**
   * A provider IS configured for this vault, but nothing here opens it.
   * Worth saying out loud; going quiet is what made the failure invisible.
   */
  blocked: boolean;
}

/** Pure decision, so both callers can be tested without a keychain. */
export function resolveMobileFileAccess(
  /** What the registry says this vault syncs through, if anything. */
  entryProvider: string | undefined,
  /** The credential slot, or null when it is missing or unreadable. */
  stored: MobileSyncProvider | null,
  /** The account-wide token covers files (broker families). */
  filesViaBroker: boolean,
): MobileFileSyncAccess {
  if (!entryProvider) return { ready: false, blocked: false };
  if (!stored || stored.provider !== entryProvider) return { ready: false, blocked: true };

  const creds = stored.creds as {
    refreshToken?: string;
    url?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  const ready =
    stored.provider === "webdav"
      ? !!creds.url
      : stored.provider === "s3"
        ? !!(creds.accessKeyId && creds.secretAccessKey)
        : // Dropbox has no broker family: its token is always its own.
          !!creds.refreshToken || (stored.provider !== "dropbox" && filesViaBroker);
  return { ready, blocked: !ready };
}

/** Whether the account-wide token of this vault covers the file service. */
export async function filesViaBrokerToken(vaultId: string, provider: string): Promise<boolean> {
  for (const account of await loadCloudAccounts(vaultId).catch(() => [])) {
    if (account.services.files?.provider !== provider) continue;
    const token = await getAccountToken(vaultId, account.id).catch(() => null);
    if (token?.refreshToken) return true;
  }
  return false;
}

/** Reads the vault's provider slot (a missing or unreadable slot counts as absent). */
export async function readStoredProvider(vaultId: string): Promise<MobileSyncProvider | null> {
  const stored = await getPlatformServices()
    .credentials.readSecret<MobileSyncProvider>(syncProviderSlot(vaultId))
    .catch(() => null);
  return stored && stored.provider ? stored : null;
}
