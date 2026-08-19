import type {
  DriveMobileCredentials,
  DropboxMobileCredentials,
  OneDriveMobileCredentials,
} from "./syncService";
import type { S3Credentials, WebDavCredentials } from "@plainva/core";

/**
 * The vault's ONE file-provider slot: name and shape, without the worker.
 *
 * It sits apart from `syncService` on purpose — the account cards need to know
 * whether this device can open the file connection, and pulling the sync
 * runtime (and with it the vault registry and the whole worker) into a card
 * renderer would be a dependency nobody wants to reason about.
 */
export const syncProviderSlot = (vaultId: string) => `sync_provider_mobile_${vaultId}`;

export type MobileSyncProvider =
  | { provider: "webdav"; creds: WebDavCredentials }
  | { provider: "s3"; creds: S3Credentials }
  | { provider: "drive"; creds: DriveMobileCredentials }
  | { provider: "onedrive"; creds: OneDriveMobileCredentials }
  | { provider: "dropbox"; creds: DropboxMobileCredentials };
