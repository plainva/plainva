import type { S3Credentials, WebDavCredentials } from "@plainva/core";
import type { SyncProviderId } from "@plainva/ui";
import { brokerTokenProvider } from "./accountBroker";
import {
  credentialManager,
  type DriveStoredCredentials,
  type DropboxStoredCredentials,
  type OneDriveStoredCredentials,
} from "./CredentialManager";

/**
 * One answer to "does THIS device reach the vault's file provider?".
 *
 * The question has two halves that used to be answered in two places: the
 * loader decided whether to build a sync target at all, and the account surface
 * decided what to render — from the mere EXISTENCE of a credential slot. Those
 * two drifted apart, and the gap was invisible by construction: an account
 * connected through the union consent leaves its per-service slot without a
 * refresh token ON PURPOSE (cloud accounts stage B), so the slot existed, the
 * card said "connected", the loader built nothing, and the vault came up local
 * with the file sync silently off (findings 2026-07-30 and 2026-08-19).
 *
 * The rule therefore lives here once, and both sides read it.
 */

export interface SyncSlots {
  drive: DriveStoredCredentials | null;
  onedrive: OneDriveStoredCredentials | null;
  dropbox: DropboxStoredCredentials | null;
  s3: S3Credentials | null;
  webdav: WebDavCredentials | null;
}

export interface FileSyncAccess {
  /** Provider this vault syncs through (slot precedence), null when none. */
  provider: SyncProviderId | null;
  /** Per provider: this device holds everything needed to open it. */
  ready: Record<SyncProviderId, boolean>;
  /**
   * A provider IS configured, but nothing on this device opens it — neither its
   * own token nor the broker. Worth saying out loud; going quiet here is what
   * made the failure invisible.
   */
  blocked: SyncProviderId | null;
}

/** Pure decision, so both callers can be tested without a keychain. */
export function resolveFileSyncAccess(slots: SyncSlots, filesViaBroker: boolean): FileSyncAccess {
  const { drive, onedrive, dropbox, s3, webdav } = slots;
  const ready: Record<SyncProviderId, boolean> = {
    // Broker-backed accounts keep their ONE refresh token in the account slot
    // and leave this one empty on purpose — demanding a token here declared
    // exactly those accounts "not ready".
    drive: !!(drive && drive.clientId && drive.clientSecret && (drive.refreshToken || filesViaBroker)),
    onedrive: !!(onedrive && onedrive.clientId && (onedrive.refreshToken || filesViaBroker)),
    // Dropbox has no broker family: its token is always its own.
    dropbox: !!(dropbox && dropbox.appKey && dropbox.refreshToken),
    s3: !!(s3 && s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey && s3.region),
    webdav: !!(webdav && webdav.url),
  };

  // Same precedence as the settings form; the XOR rule means at most one slot
  // is filled anyway, so this only decides which half-filled one to name.
  const provider: SyncProviderId | null = ready.drive
    ? "drive"
    : ready.onedrive
      ? "onedrive"
      : ready.dropbox
        ? "dropbox"
        : ready.s3
          ? "s3"
          : ready.webdav
            ? "webdav"
            : null;

  const blocked: SyncProviderId | null =
    provider !== null
      ? null
      : drive
        ? "drive"
        : onedrive
          ? "onedrive"
          : dropbox
            ? "dropbox"
            : s3
              ? "s3"
              : webdav
                ? "webdav"
                : null;

  return { provider, ready, blocked };
}

/** Reads this vault's slots (a missing/unreadable slot counts as absent). */
export async function loadSyncSlots(vaultPath: string): Promise<SyncSlots> {
  const [drive, onedrive, dropbox, s3, webdav] = await Promise.all([
    credentialManager.getDriveCredentials(vaultPath).catch(() => null),
    credentialManager.getOneDriveCredentials(vaultPath).catch(() => null),
    credentialManager.getDropboxCredentials(vaultPath).catch(() => null),
    credentialManager.getS3Credentials(vaultPath).catch(() => null),
    credentialManager.getWebDavCredentials(vaultPath).catch(() => null),
  ]);
  return { drive, onedrive, dropbox, s3, webdav };
}

/** The full answer for a vault, broker included. */
export async function readFileSyncAccess(vaultPath: string): Promise<FileSyncAccess> {
  const slots = await loadSyncSlots(vaultPath);
  const viaBroker = !!(await brokerTokenProvider(vaultPath, "files").catch(() => undefined));
  return resolveFileSyncAccess(slots, viaBroker);
}
