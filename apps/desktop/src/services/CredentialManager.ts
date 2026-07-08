import { load, Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { WebDavCredentials, S3Credentials } from "@plainva/core";

/**
 * BYO Google Drive credentials as entered/stored on the desktop. clientId/clientSecret
 * come from the user's own OAuth "Desktop app" client (ADR 0006). refreshToken is filled
 * by the (maintainer-verified, native) loopback OAuth flow; it is absent until the vault
 * has been authorized. keychain binding follows ADR 0005 (A6).
 */
export interface DriveStoredCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  rootFolderName?: string;
}

/**
 * OneDrive credentials (public client, no secret; sync-provider plan 2026-07-04).
 * clientId is Plainva's central Entra app registration once it exists (M-A), or a
 * user-supplied one until then. refreshToken comes from the loopback OAuth flow and
 * is REWRITTEN whenever Microsoft rotates it (onTokensRefreshed persistence).
 */
export interface OneDriveStoredCredentials {
  clientId: string;
  refreshToken?: string;
  rootFolderName?: string;
}

/**
 * Dropbox credentials (public client, no secret). appKey is Plainva's central app
 * once registered (M-B), or a user-supplied one until then.
 */
export interface DropboxStoredCredentials {
  appKey: string;
  refreshToken?: string;
  rootPath?: string;
}

/**
 * Persists sync credentials outside the vault (ADR 0005). Credentials are stored in the
 * OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via the
 * native `keychain_*` Tauri commands (A6). The plugin-store `credentials.bin` remains a
 * fallback for systems where the keychain is unavailable (e.g. a headless Linux box
 * without a running Secret Service) and as the migration source for credentials saved
 * before the keychain binding existed.
 *
 * NOTE (maintainer): the keychain path depends on native Rust code that was not verified
 * in the AI harness. The store fallback keeps the app functional regardless; verify the
 * native keychain path before release.
 */
export class CredentialManager {
  // Lazy on purpose: the singleton below is created at module load, and an
  // eager `load()` would fire (and, without Tauri, reject unhandled) for
  // every importer — even sessions that never touch credentials.
  private storePromise: Promise<Store> | null = null;

  private store(): Promise<Store> {
    if (!this.storePromise) this.storePromise = load("credentials.bin");
    return this.storePromise;
  }

  private vaultKey(prefix: string, vaultPath: string): string {
    return `${prefix}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
  }

  // --- keychain bridge (graceful fallback to the plugin-store) ---

  /** Returns `undefined` when the keychain is unavailable, so callers fall back to the store. */
  private async keychainGet(key: string): Promise<string | null | undefined> {
    try {
      return await invoke<string | null>("keychain_get", { key });
    } catch {
      return undefined;
    }
  }

  private async keychainSet(key: string, value: string): Promise<boolean> {
    try {
      await invoke("keychain_set", { key, value });
      return true;
    } catch {
      return false;
    }
  }

  private async keychainDelete(key: string): Promise<void> {
    try {
      await invoke("keychain_delete", { key });
    } catch {
      /* keychain unavailable: store-only cleanup below still runs */
    }
  }

  private async storeDelete(key: string): Promise<void> {
    const store = await this.store();
    await store.delete(key);
    await store.save();
  }

  private async readSecret<T>(key: string): Promise<T | null> {
    const fromKeychain = await this.keychainGet(key);
    if (fromKeychain !== undefined) {
      if (fromKeychain) return JSON.parse(fromKeychain) as T;
      // Keychain reachable but empty: migrate a pre-keychain store entry, if any.
      const legacy = await (await this.store()).get<T>(key);
      if (legacy) {
        const migrated = await this.keychainSet(key, JSON.stringify(legacy));
        if (migrated) await this.storeDelete(key);
        return legacy;
      }
      return null;
    }
    // Keychain unavailable: store fallback.
    const value = await (await this.store()).get<T>(key);
    return value || null;
  }

  private async writeSecret<T>(key: string, value: T): Promise<void> {
    const ok = await this.keychainSet(key, JSON.stringify(value));
    if (ok) {
      await this.storeDelete(key); // avoid a stale plaintext copy lingering in the store
      return;
    }
    const store = await this.store();
    await store.set(key, value);
    await store.save();
  }

  private async removeSecret(key: string): Promise<void> {
    await this.keychainDelete(key);
    await this.storeDelete(key);
  }

  // --- WebDAV ---

  public async getWebDavCredentials(vaultPath: string): Promise<WebDavCredentials | null> {
    return this.readSecret<WebDavCredentials>(this.vaultKey("webdav_credentials", vaultPath));
  }

  public async saveWebDavCredentials(vaultPath: string, creds: WebDavCredentials): Promise<void> {
    await this.writeSecret(this.vaultKey("webdav_credentials", vaultPath), creds);
  }

  public async clearWebDavCredentials(vaultPath: string): Promise<void> {
    await this.removeSecret(this.vaultKey("webdav_credentials", vaultPath));
  }

  // --- Google Drive (BYO) ---

  public async getDriveCredentials(vaultPath: string): Promise<DriveStoredCredentials | null> {
    return this.readSecret<DriveStoredCredentials>(this.vaultKey("drive_credentials", vaultPath));
  }

  public async saveDriveCredentials(vaultPath: string, creds: DriveStoredCredentials): Promise<void> {
    await this.writeSecret(this.vaultKey("drive_credentials", vaultPath), creds);
  }

  public async clearDriveCredentials(vaultPath: string): Promise<void> {
    await this.removeSecret(this.vaultKey("drive_credentials", vaultPath));
  }

  // --- S3-compatible object storage ---

  public async getS3Credentials(vaultPath: string): Promise<S3Credentials | null> {
    return this.readSecret<S3Credentials>(this.vaultKey("s3_credentials", vaultPath));
  }

  public async saveS3Credentials(vaultPath: string, creds: S3Credentials): Promise<void> {
    await this.writeSecret(this.vaultKey("s3_credentials", vaultPath), creds);
  }

  public async clearS3Credentials(vaultPath: string): Promise<void> {
    await this.removeSecret(this.vaultKey("s3_credentials", vaultPath));
  }

  // --- OneDrive ---

  public async getOneDriveCredentials(vaultPath: string): Promise<OneDriveStoredCredentials | null> {
    return this.readSecret<OneDriveStoredCredentials>(this.vaultKey("onedrive_credentials", vaultPath));
  }

  public async saveOneDriveCredentials(vaultPath: string, creds: OneDriveStoredCredentials): Promise<void> {
    await this.writeSecret(this.vaultKey("onedrive_credentials", vaultPath), creds);
  }

  public async clearOneDriveCredentials(vaultPath: string): Promise<void> {
    await this.removeSecret(this.vaultKey("onedrive_credentials", vaultPath));
  }

  // --- Dropbox ---

  public async getDropboxCredentials(vaultPath: string): Promise<DropboxStoredCredentials | null> {
    return this.readSecret<DropboxStoredCredentials>(this.vaultKey("dropbox_credentials", vaultPath));
  }

  public async saveDropboxCredentials(vaultPath: string, creds: DropboxStoredCredentials): Promise<void> {
    await this.writeSecret(this.vaultKey("dropbox_credentials", vaultPath), creds);
  }

  public async clearDropboxCredentials(vaultPath: string): Promise<void> {
    await this.removeSecret(this.vaultKey("dropbox_credentials", vaultPath));
  }

  // --- Diagnostics ---

  public async checkKeychainStatus(): Promise<'native' | 'fallback'> {
    try {
      await invoke("keychain_get", { key: "plainva_dummy_diagnostic_key" });
      return 'native';
    } catch {
      return 'fallback';
    }
  }
}


export const credentialManager = new CredentialManager();
