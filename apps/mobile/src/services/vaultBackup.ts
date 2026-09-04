import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { buildZipFileName, sanitizeFileName, selectZipsToDelete, shouldRunZip } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { buildVaultZip } from "./vaultExport";
import type { MobileVault } from "./vaultService";
import { classifyBackupListing, type BackupListing, type UnreadableMark } from "./backupListing";

/**
 * The scheduled vault archive on the phone (S36).
 *
 * The desktop has had a daily ZIP with retention since its backup package; the
 * phone had an on-demand export and nothing else, so a vault nobody thought to
 * export by hand had no archive at all — which is precisely the vault that
 * needs one.
 *
 * Two differences from the desktop are real and stay:
 *
 *  - **Where.** A phone has no directory picker, so the archive goes to the
 *    app's documents directory (`Plainva Backups/<vault>/`), which is visible
 *    in the files app and included in the device backup. `Directory.Cache`
 *    would have been easier and wrong: the OS empties it, and an archive the
 *    system may delete is not an archive.
 *  - **When.** A phone gets no background timer. The check runs on open and on
 *    return to the foreground and is a CATCH-UP: "more than a day since the
 *    last one" rather than "at 03:00". A schedule that only fires while the app
 *    happens to be open must not pretend to be a clock.
 *
 * **Measured caveat on Android (finding 2026-08-25).** `Directory.Documents`
 * is the PUBLIC folder there, and the files in it belong to the UID of the app
 * that created them. After an uninstall+reinstall the archives survive on disk
 * but this app can no longer reach them — and `readdir` then returns an EMPTY
 * LIST rather than an error, so both call sites below sailed straight past
 * their catch blocks: retention found nothing to prune (archives grew without
 * bound) and `listBackups()` reported zero to the vault detail screen while the
 * files were sitting right there. Nothing is lost — new archives still write —
 * but the count lied. Since C25 (2026-09-04) `listBackups()` names that state
 * (`unreadable`, rule in `backupListing.ts`) instead of claiming "0 backups";
 * the retention still cannot reach those files, which is exactly what the
 * card on the vault page says. No parity entry: the desktop has no
 * `Documents` notion, so this is an Android platform fact, not an asymmetry
 * between the two shells.
 *
 * Naming, retention and the due-check are the shared ones (`@plainva/ui`), so
 * two devices archiving the same vault prune by one rule.
 */

const DIR = Directory.Documents;
const ROOT = "Plainva Backups";

const lastRunKey = (vaultId: string) => `m-backup-zip-last-${vaultId}`;
// Keyed by the folder name, not the vault id: the folder is what survives a
// reinstall, and the vault id is minted fresh by the new installation.
const unreadableKey = (name: string) => `m-backup-unreadable-${sanitizeFileName(name)}`;

function readUnreadableMark(name: string): UnreadableMark {
  const raw = localStorage.getItem(unreadableKey(name));
  return raw === "detected" || raw === "dismissed" ? raw : "none";
}

let running = false;
export function isBackupRunning(): boolean {
  return running;
}

function readLastRun(vaultId: string): number {
  const raw = localStorage.getItem(lastRunKey(vaultId));
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function backupFolderFor(name: string): string {
  return `${ROOT}/${sanitizeFileName(name)}`;
}

export interface BackupState {
  enabled: boolean;
  keep: number;
  /** Epoch ms of the last successful archive; 0 = never. */
  lastRun: number;
}

export function backupState(vaultId: string): BackupState {
  const s = getMobileSettings();
  return { enabled: s.backupZipEnabled, keep: s.backupZipKeep, lastRun: readLastRun(vaultId) };
}

/**
 * Writes one archive and prunes the folder down to `keep`. Returns the file
 * name written, or null when the platform cannot store one (the browser
 * fixture has no documents directory).
 */
export async function runVaultBackup(vault: MobileVault, name: string): Promise<string | null> {
  if (Capacitor.getPlatform() === "web") return null;
  if (running) return null;
  running = true;
  try {
    const folder = backupFolderFor(name);
    const fileName = buildZipFileName(name, new Date());
    const zip = await buildVaultZip(vault);
    await Filesystem.writeFile({ path: `${folder}/${fileName}`, directory: DIR, data: zip, recursive: true });

    // Prune only AFTER the new archive exists: deleting first would leave a
    // window in which a failed write means one fewer backup than promised.
    try {
      const listing = await Filesystem.readdir({ path: folder, directory: DIR });
      const names = listing.files.map((f) => (typeof f === "string" ? f : f.name));
      for (const stale of selectZipsToDelete(names, name, getMobileSettings().backupZipKeep)) {
        await Filesystem.deleteFile({ path: `${folder}/${stale}`, directory: DIR }).catch(() => {});
      }
    } catch {
      /* an unreadable folder costs the pruning, not the archive */
    }

    localStorage.setItem(lastRunKey(vault.vaultId), String(Date.now()));
    return fileName;
  } finally {
    running = false;
  }
}

/**
 * Catch-up check: runs an archive if one is due. Called on vault open and on
 * return to the foreground. Failures stay silent — a missed archive must never
 * interrupt what someone opened the app to do; the vault detail screen shows
 * when the last one succeeded, which is where an absence becomes visible.
 */
export async function backupIfDue(vault: MobileVault, name: string): Promise<void> {
  const { enabled, lastRun } = backupState(vault.vaultId);
  if (!shouldRunZip({ enabled, lastRun, now: Date.now(), running })) return;
  try {
    await runVaultBackup(vault, name);
  } catch {
    /* see above */
  }
}

/**
 * Archives of a vault, newest first — the detail screen's "N archives" line —
 * plus whether the folder holds files this installation cannot read (C25).
 * `lastRun` is the epoch of the last archive THIS installation wrote (0 =
 * never); it keeps a folder that was merely emptied by hand from reading as
 * unreadable.
 */
export async function listBackups(name: string, lastRun = 0): Promise<BackupListing> {
  if (Capacitor.getPlatform() === "web") return { archives: [], unreadable: false };
  const folder = backupFolderFor(name);
  let folderExists = false;
  let names: string[] = [];
  try {
    await Filesystem.stat({ path: folder, directory: DIR });
    folderExists = true;
  } catch {
    folderExists = false;
  }
  if (folderExists) {
    try {
      const listing = await Filesystem.readdir({ path: folder, directory: DIR });
      names = listing.files.map((f) => (typeof f === "string" ? f : f.name));
    } catch {
      /* a folder that exists but cannot be listed is the unreadable case too */
    }
  }
  const remembered = readUnreadableMark(name);
  const result = classifyBackupListing({ folderExists, names, lastRun, remembered });
  if (result.unreadable && remembered === "none") localStorage.setItem(unreadableKey(name), "detected");
  return result;
}

/** The user has read the card; stop showing it for this folder. */
export function dismissUnreadableBackups(name: string): void {
  localStorage.setItem(unreadableKey(name), "dismissed");
}
