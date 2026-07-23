import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { getSettingsStore } from "./settingsStore";
import { indexDbFileName } from "./indexDbPath";
import { backupZipDestKey, defaultZipDestination, vaultFolderName } from "./backupPolicy";
import { zipNamePattern } from "./vaultZipBackup";
import { credentialManager } from "./CredentialManager";

/**
 * "Forget this vault" (splash remove dialog, maintainer decision E1
 * 2026-07-09): removing a recent vault used to drop only the list entry —
 * the index DB, ~20 per-vault settings keys, the window layout and even the
 * sync credentials survived, so re-opening the same folder was fully
 * recognized. This service deletes every piece of per-vault app data OUTSIDE
 * the vault folder; the vault folder itself (notes, `.plainva/` with pins,
 * bookmarks and snapshot backups) is deliberately never touched — those are
 * the user's files. Automatic ZIP backups in app-data are only removed on
 * explicit opt-in (they are the safety net).
 *
 * Every step is best-effort: a locked DB (another instance) or a missing
 * folder must not stop the remaining cleanup. Errors are collected and
 * reported, not thrown.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

/** Store-key suffix shared by EVERY per-vault settings key (`<name>_<b64(path)>`). */
export function perVaultStoreSuffix(vaultPath: string): string {
  return `_${b64(vaultPath)}`;
}

/**
 * localStorage keys belonging to the vault. Prefix-matched so per-file
 * variants (e.g. base view state) are covered too.
 */
export function collectPerVaultLocalStorageKeys(vaultPath: string, allKeys: string[]): string[] {
  const prefixes = [
    `plainva-layout-${vaultPath}`,
    `recentPaths-${vaultPath}`,
    `plainva-base-active-view-${vaultPath}`,
    `plainva-base-subitems-${vaultPath}`,
    `plainva-prop-types::${vaultPath}`,
    `plainva-left-sections-${vaultPath}`,
  ];
  return allKeys.filter((k) => prefixes.some((p) => k === p || k.startsWith(p)));
}

export interface ForgetVaultResult {
  ok: boolean;
  errors: string[];
}

export async function forgetVaultData(
  vaultPath: string,
  opts: { deleteZipBackups: boolean }
): Promise<ForgetVaultResult> {
  const errors: string[] = [];
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[vaultForget] ${what} failed for ${vaultPath}`, e);
      errors.push(what);
    }
  };

  // ZIP backups first: the custom-destination setting is read from the store
  // BEFORE the store purge below deletes it.
  if (opts.deleteZipBackups) {
    await attempt("zip-backups", async () => {
      const store = await getSettingsStore();
      const custom = ((await store.get<string>(backupZipDestKey(vaultPath))) ?? "").trim();
      const def = await defaultZipDestination(vaultPath);
      // The default destination folder exists exclusively for this vault
      // (name + path hash) — remove it as a whole.
      if (await exists(def)) await remove(def, { recursive: true });
      // A custom destination may be a shared user/NAS folder: delete ONLY
      // files matching our strict zip name pattern, never the folder.
      if (custom && custom !== def && (await exists(custom))) {
        const pattern = zipNamePattern(vaultFolderName(vaultPath));
        for (const entry of await readDir(custom)) {
          if (!entry.isDirectory && pattern.test(entry.name)) {
            await remove(await join(custom, entry.name));
          }
        }
      }
    });
  }

  // Index DB in app-data (+ WAL/SHM sidecars). A fresh open of the same path
  // then starts with a clean index, exactly like a never-seen vault.
  await attempt("index-db", async () => {
    const base = await join(await appDataDir(), "index", await indexDbFileName(vaultPath));
    for (const p of [base, `${base}-wal`, `${base}-shm`]) {
      if (await exists(p)) await remove(p);
    }
  });

  // Crash-recovery draft journal (P2.4) — note text snapshots live in
  // app-data and must not survive "forget app data".
  await attempt("draft-journal", async () => {
    const { removeVaultDrafts } = await import("./draftJournal");
    await removeVaultDrafts(vaultPath);
  });

  // Content-E2E connection pin (`e2eState_<b64(connectionId)>`): keyed by the
  // connection fingerprint (provider + remote root), NOT the vault path, so the
  // suffix sweep below misses it. Derive the connection id from the still-present
  // cloud-account records and drop the pin — otherwise re-connecting the same
  // provider+folder reanimates `knownEncrypted:true` and the fail-closed guard
  // bricks the sync (maintainer teardown bug, 2026-07-22). Must run BEFORE the
  // settings sweep, which deletes the cloud-account records it reads.
  await attempt("encryption-state", async () => {
    const { getActiveConnectionId } = await import("./settingsProfile");
    const connectionId = await getActiveConnectionId(vaultPath);
    if (connectionId) {
      const { clearConnectionState } = await import("./encryptionManifest");
      await clearConnectionState(connectionId);
    }
  });

  // Every per-vault settings key — matched by the shared `_<b64(path)>`
  // suffix so future per-vault keys are covered without a registry.
  await attempt("settings", async () => {
    const store = await getSettingsStore();
    const suffix = perVaultStoreSuffix(vaultPath);
    for (const key of await store.keys()) {
      if (key.endsWith(suffix)) await store.delete(key);
    }
    await store.save();
  });

  // Window/layout & view state in localStorage.
  await attempt("local-storage", async () => {
    const all: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k !== null) all.push(k);
    }
    for (const k of collectPerVaultLocalStorageKeys(vaultPath, all)) {
      window.localStorage.removeItem(k);
    }
  });

  // Sync credentials of all five providers (keyed per vault in the OS
  // keychain / credentials.bin fallback).
  await attempt("credentials", async () => {
    const results = await Promise.allSettled([
      credentialManager.clearWebDavCredentials(vaultPath),
      credentialManager.clearDriveCredentials(vaultPath),
      credentialManager.clearS3Credentials(vaultPath),
      credentialManager.clearOneDriveCredentials(vaultPath),
      credentialManager.clearDropboxCredentials(vaultPath),
    ]);
    if (results.some((r) => r.status === "rejected")) throw new Error("credential cleanup incomplete");
  });

  return { ok: errors.length === 0, errors };
}
