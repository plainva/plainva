import { DEFAULT_ZIP_KEEP, sanitizeFileName as sanitize, type ISettingsStore } from "@plainva/ui";
import { appDataDir, join } from "@tauri-apps/api/path";
import { BackupRetentionPolicy, DEFAULT_BACKUP_RETENTION } from "@plainva/core";

/** Same file as STORE_KEY in services/settingsStore.ts; duplicated here so this policy module stays free of runtime store imports. */
export const SETTINGS_STORE_FILE = "plainva-settings.json";

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

// Per-vault store keys (same encoding pattern as syncIntervalKey in VaultContext).
export const backupZipEnabledKey = (v: string) => `backupZipEnabled_${b64(v)}`;
export const backupZipDestKey = (v: string) => `backupZipDest_${b64(v)}`;
export const backupZipKeepKey = (v: string) => `backupZipKeep_${b64(v)}`;
export const backupZipLastRunKey = (v: string) => `backupZipLastRun_${b64(v)}`;
export const backupSnapshotIntervalKey = (v: string) => `backupSnapshotIntervalSeconds_${b64(v)}`;
export const backupMaxCountKey = (v: string) => `backupMaxCountPerFile_${b64(v)}`;
export const backupMaxAgeDaysKey = (v: string) => `backupMaxAgeDays_${b64(v)}`;
export const backupPruneLastRunKey = (v: string) => `backupPruneLastRun_${b64(v)}`;

/* The naming, the pruning and the due-check moved to `@plainva/ui` in S36 so
   the phone prunes by the same rules — a retention rule that drifts between
   shells deletes different files on two devices looking at one folder. */
export { DEFAULT_ZIP_KEEP, ZIP_INTERVAL_MS, ZIP_EXCLUDED_DIR_NAMES, sanitizeFileName } from "@plainva/ui";

export async function loadBackupRetentionSettings(store: ISettingsStore, vaultPath: string): Promise<BackupRetentionPolicy> {
  const interval = await store.get<number>(backupSnapshotIntervalKey(vaultPath));
  const maxCount = await store.get<number>(backupMaxCountKey(vaultPath));
  const maxAge = await store.get<number>(backupMaxAgeDaysKey(vaultPath));
  return {
    minSnapshotIntervalSeconds: interval ?? DEFAULT_BACKUP_RETENTION.minSnapshotIntervalSeconds,
    maxBackupsPerFile: maxCount ?? DEFAULT_BACKUP_RETENTION.maxBackupsPerFile,
    maxAgeDays: maxAge ?? DEFAULT_BACKUP_RETENTION.maxAgeDays,
    // Deliberately not a setting (C21): the size limit is a data-safety rule,
    // not a preference. A slider here would let someone set it to zero and get
    // a hundred copies of a 90 MB file back — nine gigabytes inside the vault.
    maxSnapshotBytes: DEFAULT_BACKUP_RETENTION.maxSnapshotBytes,
  };
}

export interface ZipBackupSettings {
  enabled: boolean;
  /** Custom destination directory; "" = the app-data default. */
  dest: string;
  keep: number;
  /** Epoch ms of the last successful run; 0 = never. */
  lastRun: number;
}

export async function loadZipBackupSettings(store: ISettingsStore, vaultPath: string): Promise<ZipBackupSettings> {
  const enabled = await store.get<boolean>(backupZipEnabledKey(vaultPath));
  const dest = await store.get<string>(backupZipDestKey(vaultPath));
  const keep = await store.get<number>(backupZipKeepKey(vaultPath));
  const lastRun = await store.get<number>(backupZipLastRunKey(vaultPath));
  return {
    enabled: enabled ?? true,
    dest: dest ?? "",
    keep: keep ?? DEFAULT_ZIP_KEEP,
    lastRun: lastRun ?? 0,
  };
}

export function vaultFolderName(vaultPath: string): string {
  return vaultPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Vault";
}

/** Short filesystem-safe vault identity (btoa output is not: '/', '+'). */
export async function sha8(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** `<appData>/backups/<VaultName>-<sha256-8>` — outside the vault, survives vault loss. */
export async function defaultZipDestination(vaultPath: string): Promise<string> {
  const dir = await appDataDir();
  const hash = await sha8(vaultPath);
  return join(dir, "backups", `${sanitize(vaultFolderName(vaultPath))}-${hash}`);
}
