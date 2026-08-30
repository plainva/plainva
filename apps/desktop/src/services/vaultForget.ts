import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { getSettingsStore } from "./settingsStore";
import { indexDbFileName } from "./indexDbPath";
import { backupZipDestKey, defaultZipDestination, vaultFolderName } from "./backupPolicy";
import { zipNamePattern } from "./vaultZipBackup";
import { credentialManager } from "./CredentialManager";
import { allVaultSlots, vaultSlotIds } from "./keychainSlots";

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
    `plainva-mail-cols-${vaultPath}`,
    `plainva-mail-threads-${vaultPath}`,
    // Auxiliary windows: which ones were open, and their per-window split
    // layout (the `plainva-layout-` prefix above already covers the latter).
    `plainva-windows-${vaultPath}`,
    // Pre-existing gap, same class as the line above: the file tree kept its
    // expanded folders across a "forget this vault" and handed them to the
    // next vault opened at that path.
    `plainva-expanded-${vaultPath}`,
  ];
  return allKeys.filter((k) => prefixes.some((p) => k === p || k.startsWith(p)));
}

export interface ForgetVaultResult {
  ok: boolean;
  errors: string[];
}

/**
 * Every keychain slot this vault owns, in both name shapes (E2, P6).
 *
 * Until now "forget this vault" cleared the provider credentials and left
 * everything else behind: the calendar and mailbox passwords, the per-account
 * OAuth tokens of the broker, the settings-sync master-key cache. Re-opening
 * the same folder found them again, and a folder that was never re-opened kept
 * them forever — the maintainer's keychain still holds `mkcache_` for a vault
 * path that no longer exists (2026-08-10).
 *
 * The names are derived from what the SETTINGS store knows (`vaultSlotIds`), so
 * this has to run before the settings sweep deletes its own sources.
 *
 * Exported for the test: the derivation is the part that can silently miss a
 * slot, and a missed slot is a credential that outlives its vault.
 */
export async function collectVaultKeychainSlots(vaultPath: string): Promise<string[]> {
  // Both name shapes (P6): a vault opened before the rename can still hold the
  // old ones, and a migration that could not finish leaves them behind on
  // purpose. Forgetting a vault has to reach either.
  return allVaultSlots(vaultPath, await vaultSlotIds(vaultPath));
}

/**
 * The encrypted workspace's own keys (finding 2026-08-30).
 *
 * "Forget this vault" swept the account slots and left the workspace runtime
 * behind: the device key of an encrypted workspace, in the OS keychain, for a
 * vault the user believes they just removed. Exactly the class of leftover the
 * 2026-08-19 sweep was written against, one family further down.
 *
 * The publication slots (S4b) are worse than the runtime slot, because they are
 * not derivable: their ids live in `workspace_publication` inside the index DB,
 * which this service deletes moments later. So they are read here, from the
 * still-present database, and the read failing must not cost us the runtime
 * slot - hence the inner catch rather than one try around both.
 *
 * Exported for the test: the ordering is the part that can silently miss a
 * slot, and a missed publication slot is a publisher admin key nobody can find
 * again (the keychain cannot be enumerated).
 */
export async function forgetWorkspaceCredentials(vaultPath: string): Promise<void> {
  const { clearWorkspaceRuntime, clearPublicationRuntimes } = await import(
    "./workspaceSecurity/workspaceKeychain"
  );
  let publicationIds: string[] = [];
  const dbPath = await join(await appDataDir(), "index", await indexDbFileName(vaultPath));
  if (await exists(dbPath)) {
    const { TauriDatabaseAdapter } = await import("../adapters/TauriDatabaseAdapter");
    const { SqlWorkspaceStateStore } = await import("@plainva/core");
    const db = new TauriDatabaseAdapter(`sqlite:${dbPath}`);
    try {
      await db.initialize();
      publicationIds = (await new SqlWorkspaceStateStore(db).listPublications()).map(
        (record) => record.publicationId
      );
    } catch (e) {
      // A vault that never had a workspace has no such table, and a locked DB
      // is somebody else's problem - neither may stop the runtime slot below.
      console.warn("[vaultForget] could not read publication ids", e);
    } finally {
      // Owner-only close: no window holds this vault open at the splash.
      await db.close().catch(() => {});
    }
  }
  await clearPublicationRuntimes(vaultPath, publicationIds);
  await clearWorkspaceRuntime(vaultPath);
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

  // The workspace's own device key and the admin key of every publication.
  // Runs BEFORE `index-db`: the publication ids live in that database, and the
  // keychain cannot be enumerated to find a slot whose id is gone.
  await attempt("workspace-credentials", () => forgetWorkspaceCredentials(vaultPath));

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

  // Account, calendar, mailbox and master-key-cache slots (E2). Like the
  // encryption pin above this reads the settings store, so it runs BEFORE the
  // sweep that deletes those records.
  await attempt("account-credentials", async () => {
    const slots = await collectVaultKeychainSlots(vaultPath);
    const results = await Promise.allSettled(slots.map((slot) => credentialManager.removeSecret(slot)));
    if (results.some((r) => r.status === "rejected")) throw new Error("account credential cleanup incomplete");
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
