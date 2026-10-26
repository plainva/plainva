import { filesRunState, getPlatformServices, isSignedOutSlot } from "@plainva/ui";
import { fileBrokerTokenProvider } from "./accountBroker";
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
  /**
   * Blocked because "Sign out on this device" dropped the password, secret key
   * or token here (plan "Verbinden", V2): the fix is signing in, not "again".
   */
  signedOut?: boolean;
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
  // Only the mark sign-out leaves says "signed out"; an empty password alone is a server without one.
  const signedOut = isSignedOutSlot(stored, "creds");
  if (signedOut) return { ready: false, blocked: true, signedOut: true };

  const creds = stored.creds as {
    refreshToken?: string;
    nativeGoogle?: { email?: string };
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
          !!creds.refreshToken || (stored.provider === "drive" && !!creds.nativeGoogle?.email) || (stored.provider !== "dropbox" && filesViaBroker);
  return { ready, blocked: !ready };
}

/**
 * Whether the active vault's sync worker may start, and what the status says
 * when it may not. Every way the files stand still is a decision here, not a
 * failure - the person paused them (`pausedHere`, their own switch, never
 * touched by the app's own pause), the app paused them (`paused`, a password
 * change in flight), or files are off for the vault (E3) - except two: a vault
 * signed out on this phone, which must not ask the provider with an emptied
 * password (review of plan "Verbinden", finding 3), and a slot nothing here
 * opens.
 */
export type MobileSyncStart =
  | { start: true; settingsOnly: boolean }
  | { start: false; status: "off" | "error"; messageKey: string | null; queueLocalChanges: boolean };

export function mobileSyncStart(input: {
  pausedHere?: boolean;
  filesOff: boolean;
  entryProvider?: string;
  stored: MobileSyncProvider | null;
}): MobileSyncStart {
  // A vault with a provider keeps queueing what changes on this phone while
  // its sync stands still, so turning it on again sends what changed in the
  // meantime (review finding 4); a vault without one has nothing to send to.
  const queueLocalChanges = !!input.entryProvider;
  const signedOut = !!input.stored && isSignedOutSlot(input.stored, "creds");
  const run = filesRunState({ filesOff: input.filesOff, pausedHere: !!input.pausedHere, signedOut });
  if (run === "stopped") {
    return signedOut
      ? { start: false, status: "error", messageKey: "deviceSignIn.needed", queueLocalChanges }
      : { start: false, status: "off", messageKey: null, queueLocalChanges };
  }
  if (!input.stored) return input.entryProvider ? { start: false, status: "error", messageKey: "cloudAccounts.filesNoAccess", queueLocalChanges } : { start: false, status: "off", messageKey: null, queueLocalChanges };
  // Files off for the vault: no file moves, the settings profile keeps travelling (second review, B3).
  return { start: true, settingsOnly: run === "settingsOnly" };
}

/** Whether the account-wide token of this vault covers the file service. */
export async function filesViaBrokerToken(vaultId: string, provider: string): Promise<boolean> {
  const stored = await readStoredProvider(vaultId);
  if (!stored || stored.provider !== provider || (stored.provider !== "drive" && stored.provider !== "onedrive")) return false;
  return !!(await fileBrokerTokenProvider(vaultId, { provider: stored.provider, ...stored.creds }));
}

/** Reads the vault's provider slot (a missing or unreadable slot counts as absent). */
export async function readStoredProvider(vaultId: string): Promise<MobileSyncProvider | null> {
  const stored = await getPlatformServices()
    .credentials.readSecret<MobileSyncProvider>(syncProviderSlot(vaultId))
    .catch(() => null);
  return stored && stored.provider ? stored : null;
}
