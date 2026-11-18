import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { availableZipFileName, sanitizeFileName, selectZipsToDelete, shouldRunZip, toast, reportingTo } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { isMissingFile } from "../adapters/fileErrors";
import { getMobileSettings } from "./mobileSettings";
import { appendDocumentPart, atomicWriteInternalText, nativeFileDigest, scanDocumentFiles } from "../platform/atomicFile";
import { internalPlace } from "../platform/internalFiles";
import { PartFileSink, streamVaultZip, ZipStoppedError } from "./vaultExport";
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
 *
 * **The archive never crosses the bridge whole (release list F51).** It used
 * to be built in memory and written as one base64 message; a vault that had
 * grown to 88 MB made that one 118 MB message, and Android ran out of memory
 * parsing it on its UI thread 40 s after every start. Now it is written as it
 * is made, in parts (`streamVaultZip`, `PartFileSink`), and checked by its size
 * and the SHA-256 the system takes of the file where it lies against the one
 * taken while writing - a truncated archive is never a success, and nothing
 * is read back. A try is marked BEFORE it begins, so one that ends the app
 * counts as failed; after a failure the next automatic try waits a day, then
 * longer each time, and the vault screen says the last one failed. "Back up
 * now" always runs. The automatic one waits until the app is quiet: after the
 * first frame and the start-up index pass.
 *
 * **No media scan per part (release list F56).** On Android the Filesystem
 * plugin asks the system to index a file at every write into the public
 * Documents folder - once per part, some 2 000 scans for a 500 MB vault. So
 * there the parts are written natively without one (`appendDocumentPart`),
 * and the finished archive is indexed once. It is written where it will lie:
 * made elsewhere and copied, it took its room twice for a moment, and a vault
 * whose archive fits the free space once would no longer be backed up.
 */

const DIR = Directory.Documents;
const ROOT = "Plainva Backups";
const onAndroid = (): boolean => Capacitor.getPlatform() === "android";

const lastRunKey = (vaultId: string) => `m-backup-zip-last-${vaultId}`;
/** The last try that has not ended in an archive: `{ at, failures, error }` (see the module comment). */
const attemptKey = (vaultId: string) => `m-backup-zip-attempt-${vaultId}`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest wait between two automatic tries after failures. */
const MAX_BACKOFF_MS = 7 * DAY_MS;

export interface BackupAttempt {
  /** Epoch ms the try began, or ended. */
  at: number;
  /** Tries in a row that ended without an archive, the running one not counted. */
  failures: number;
  /** Set while a try runs. Found set when none runs: that try ended the app, and counts as failed. */
  inProgress?: boolean;
  /** What ended it, as a kind (`Error` name), when it ended without ending the app. */
  error?: string;
  /** Rises with every state written: a read never puts back an older one. */
  seq?: number;
}

/** The mark's durable copy (fsync), among the app's own files; the settings' copy is the screen's quick answer. */
const attemptFile = (vaultId: string) => `backup/attempt-${encodeURIComponent(vaultId)}.json`;

function parseAttempt(raw: string | null | undefined): BackupAttempt | null {
  try {
    const value = raw ? (JSON.parse(raw) as BackupAttempt) : null;
    return value && Number.isFinite(value.at) && Number.isFinite(value.failures) ? value : null;
  } catch {
    return null;
  }
}

/** The mark as the screen last saw it (quick, may lag a process that died); `loadBackupAttempt` is the truth. */
export function readBackupAttempt(vaultId: string): BackupAttempt | null {
  try {
    return parseAttempt(localStorage.getItem(attemptKey(vaultId)));
  } catch {
    return null;
  }
}

/**
 * The mark from its durable copy - the one truth. The screen's copy follows it
 * only when nothing runs here and what was read is not older than what the
 * screen holds: a read that answers late (it began while a try ran) never puts
 * back a state a later write replaced.
 */
export async function loadBackupAttempt(vaultId: string): Promise<BackupAttempt | null> {
  let attempt: BackupAttempt | null;
  try {
    const place = await internalPlace(attemptFile(vaultId));
    const { data } = await Filesystem.readFile({ path: place.path, directory: place.directory, encoding: Encoding.UTF8 });
    attempt = parseAttempt(String(data));
  } catch (error) {
    // No durable copy: none was written, or an older version kept the mark in the settings only.
    if (!isMissingFile(error)) console.warn("[backup] the mark of the last try could not be read", error);
    attempt = readBackupAttempt(vaultId);
  }
  const shown = readBackupAttempt(vaultId);
  if ((shown?.seq ?? 0) > (attempt?.seq ?? 0)) return shown;
  if (!runs.has(vaultId)) mirrorAttempt(vaultId, attempt);
  return attempt;
}

function mirrorAttempt(vaultId: string, attempt: BackupAttempt | null): void {
  try {
    if (attempt) localStorage.setItem(attemptKey(vaultId), JSON.stringify(attempt));
    else localStorage.removeItem(attemptKey(vaultId));
  } catch {
    // silent: the screen's copy only; the durable one decides.
  }
  window.dispatchEvent(new CustomEvent(BACKUP_STATE_EVENT));
}

let lastSeq = 0;

/**
 * Writes the mark: durably first (fsync - a try that ends the app seconds
 * later must still be found by the next start), then the screen's copy. A try
 * always ends in a written state - a success too (no failures) - never in a
 * removed file that would read like "never tried".
 */
async function writeBackupAttempt(vaultId: string, attempt: BackupAttempt): Promise<void> {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  const written = { ...attempt, seq: lastSeq };
  await atomicWriteInternalText(attemptFile(vaultId), JSON.stringify(written));
  mirrorAttempt(vaultId, written);
}

/** Tries in a row that failed: a mark found running while no try runs here is one more (it ended the app). */
export function failuresOf(attempt: BackupAttempt | null, runningHere: boolean): number {
  if (!attempt) return 0;
  return attempt.failures + (attempt.inProgress && !runningHere ? 1 : 0);
}

/** When the next automatic try may run after `attempt` failed: a day, doubling, at most a week. */
export function nextAutomaticTry(attempt: BackupAttempt, failures = failuresOf(attempt, false)): number {
  return attempt.at + Math.min(MAX_BACKOFF_MS, DAY_MS * 2 ** Math.max(0, failures - 1));
}

/** Sent when a try begins or ends, so the line under the switch follows. */
export const BACKUP_STATE_EVENT = "m-backup-state";
// Keyed by the folder name, not the vault id: the folder is what survives a
// reinstall, and the vault id is minted fresh by the new installation.
const unreadableKey = (name: string) => `m-backup-unreadable-${sanitizeFileName(name)}`;

function readUnreadableMark(name: string): UnreadableMark {
  const raw = localStorage.getItem(unreadableKey(name));
  return raw === "detected" || raw === "dismissed" ? raw : "none";
}

/** The try running for each vault, by vault id: set before anything is waited for, so two calls never both start one. */
const runs = new Map<string, Promise<string | null>>();
export function isBackupRunning(vaultId?: string): boolean {
  return vaultId === undefined ? runs.size > 0 : runs.has(vaultId);
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
  /** A try is running in this app now. */
  running: boolean;
  /** The last try ended without an archive, or ended the app - never while one runs. */
  lastFailed: boolean;
}

export function backupState(vaultId: string): BackupState {
  const s = getMobileSettings();
  const running = runs.has(vaultId);
  return { enabled: s.backupZipEnabled, keep: s.backupZipKeep, lastRun: readLastRun(vaultId), running, lastFailed: !running && failuresOf(readBackupAttempt(vaultId), false) > 0 };
}

/**
 * Writes one archive and prunes the folder down to `keep`. Returns the file
 * name written, or null when the platform cannot store one (the browser
 * fixture has no documents directory).
 */
export function runVaultBackup(vault: MobileVault, name: string, { automatic = false }: { automatic?: boolean } = {}): Promise<string | null> {
  if (Capacitor.getPlatform() === "web") return Promise.resolve(null);
  // One try per vault: a second call - two returns to the app, "back up now" beside the
  // automatic one - joins the running try and hears its result.
  const existing = runs.get(vault.vaultId);
  if (existing) return existing;
  const run = runOnce(vault, name, automatic);
  runs.set(vault.vaultId, run);
  window.dispatchEvent(new CustomEvent(BACKUP_STATE_EVENT));
  void run.then(settle, settle);
  function settle() {
    if (runs.get(vault.vaultId) === run) runs.delete(vault.vaultId);
    window.dispatchEvent(new CustomEvent(BACKUP_STATE_EVENT));
  }
  return run;
}

async function runOnce(vault: MobileVault, name: string, automatic: boolean): Promise<string | null> {
  // Tries before this one that failed, a try found running that ended the app among them.
  const failedBefore = failuresOf(await loadBackupAttempt(vault.vaultId), false);
  try {
    // Marked durably before the vault is read: a try that ends the app is found by the next start.
    await writeBackupAttempt(vault.vaultId, { at: Date.now(), failures: failedBefore, inProgress: true });
    const folder = backupFolderFor(name);
    const present = async (file: string): Promise<boolean> => {
      try { await Filesystem.stat({ path: file, directory: DIR }); return true; }
      catch (error) { if (isMissingFile(error)) return false; throw error; }
    };
    const fileName = await availableZipFileName(name, new Date(), (file) => present(folder + "/" + file));
    const destination = folder + "/" + fileName;
    const partial = destination + "." + crypto.randomUUID() + ".part";
    // A part file a try that ended the app left (it died between two parts): never an archive, removed now.
    await removeLeftoverParts(folder);
    if (onAndroid()) await allowPublicDocuments();
    const sink = new PartFileSink(partial, DIR, onAndroid() ? (bytes, first, last) => appendDocumentPart(partial, bytes, first, last) : undefined);
    try {
      // The automatic one, switched off while it runs, stops before the next file, and the part
      // file goes. One the person asked for runs whatever the switch says.
      await streamVaultZip(vault, sink, () => automatic && !getMobileSettings().backupZipEnabled);
      const written = await sink.close();
      // Check the file on disk before publication or retention: its size and the
      // hash the system takes of it, against what was written. A resolved native
      // write alone must not turn a truncated archive into a success.
      const checked = await nativeFileDigest(partial, "DOCUMENTS");
      if (!checked || checked.size !== sink.size || checked.sha256 !== written) {
        throw new Error("Backup verification failed");
      }
      if (await present(destination)) throw new Error("Backup destination already exists");
      await Filesystem.rename({ from: partial, to: destination, directory: DIR, toDirectory: DIR });
    } catch (error) {
      // A partial archive left behind takes room until the next run; the failure itself is thrown.
      if (sink.started) await Filesystem.deleteFile({ path: partial, directory: DIR }).catch(reportingTo("backup:partial"));
      throw error;
    }
    // Indexed once, under its name; the part's name leaves the index (F56).
    if (onAndroid()) await scanDocumentFiles([destination, partial]).catch(reportingTo("backup:scan"));

    // Prune only AFTER the new archive exists: deleting first would leave a
    // window in which a failed write means one fewer backup than promised.
    try {
      const listing = await Filesystem.readdir({ path: folder, directory: DIR });
      const names = listing.files.map((f) => (typeof f === "string" ? f : f.name));
      for (const stale of selectZipsToDelete(names, name, getMobileSettings().backupZipKeep)) {
        // One archive more than asked for until the next run.
        await Filesystem.deleteFile({ path: `${folder}/${stale}`, directory: DIR }).catch(reportingTo("backup:prune"));
      }
    } catch {
      /* an unreadable folder costs the pruning, not the archive */
    }

    localStorage.setItem(lastRunKey(vault.vaultId), String(Date.now()));
    // A written success: no failures, nothing running.
    await writeBackupAttempt(vault.vaultId, { at: Date.now(), failures: 0 }).catch(reportingTo("backup:mark"));
    return fileName;
  } catch (error) {
    // Stopped because it was switched off: no failure, and nothing waits.
    const next = error instanceof ZipStoppedError
      ? { at: Date.now(), failures: failedBefore }
      : { at: Date.now(), failures: failedBefore + 1, error: error instanceof Error ? error.name : "Error" };
    await writeBackupAttempt(vault.vaultId, next).catch(reportingTo("backup:mark"));
    throw error;
  }
}

/**
 * A backup the user asked for, with its answer: the archive's name, or that it
 * failed. One function for the vault screen's "back up now" row and the
 * palette's command, so the two cannot report differently.
 */
export async function backupVaultNow(vault: MobileVault, name: string): Promise<void> {
  try {
    let file: string | null;
    try {
      file = await runVaultBackup(vault, name);
    } catch (error) {
      // It joined an automatic try that stopped because the switch went off: one of its own runs now.
      if (!(error instanceof ZipStoppedError)) throw error;
      file = await runVaultBackup(vault, name);
    }
    toast.info(file ? i18n.t("mobile.backupZipDone", { name: file }) : i18n.t("mobile.vaultExportFailed"));
  } catch {
    toast.warning(i18n.t("mobile.vaultExportFailed"));
  }
}

/** The least time after the vault opened before the automatic archive starts. */
const QUIET_AFTER_MS = 15_000;
/** The most it waits for the index pass. */
const QUIET_AT_MOST_MS = 3 * 60_000;

/**
 * Resolves once the start is quiet: the first frame is drawn, the start-up
 * index pass is through (or three minutes have gone by), and at least 15 s
 * have passed - the automatic archive reads the whole vault and must not do it
 * beside the index pass in the first seconds.
 */
export async function whenStartIsQuiet(vault: Pick<MobileVault, "indexSettled">, now = () => Date.now(), wait = (ms: number) => new Promise<void>((resume) => setTimeout(resume, ms))): Promise<void> {
  const began = now();
  await new Promise<void>((resume) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resume()) : resume()));
  while (!vault.indexSettled() && now() - began < QUIET_AT_MOST_MS) await wait(2000);
  const left = QUIET_AFTER_MS - (now() - began);
  if (left > 0) await wait(left);
}

/**
 * Catch-up check: runs an archive if one is due. Called on vault open and on
 * return to the foreground. A failed automatic run reports the vault by name;
 * the previous successful timestamp remains unchanged so the next check retries.
 */
/** Removes the part files a try that ended the app left in the folder (they end in `.part`, never `.zip`). */
async function removeLeftoverParts(folder: string): Promise<void> {
  let names: string[];
  try {
    const listing = await Filesystem.readdir({ path: folder, directory: DIR });
    names = listing.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    // silent: a folder that does not exist yet holds no leftovers.
    return;
  }
  for (const name of names.filter((entry) => entry.endsWith(".part"))) {
    await Filesystem.deleteFile({ path: `${folder}/${name}`, directory: DIR }).catch(reportingTo("backup:partial"));
  }
}

/**
 * Android before 10 asks the person once for the shared folders, as the
 * Filesystem plugin did at its first write there; from Android 11 on it is
 * granted. A refusal is the write's failure, named by the native side.
 */
async function allowPublicDocuments(): Promise<void> {
  const state = await Filesystem.checkPermissions().catch(() => null);
  if (state && state.publicStorage !== "granted") await Filesystem.requestPermissions().catch(() => {
    // silent: the native write below fails and says why.
  });
}

export async function backupIfDue(vault: MobileVault, name: string): Promise<void> {
  const { enabled, lastRun } = backupState(vault.vaultId);
  if (!shouldRunZip({ enabled, lastRun, now: Date.now(), running: runs.has(vault.vaultId) })) return;
  // After a failure - or a try that ended the app - not before the wait is over.
  const attempt = await loadBackupAttempt(vault.vaultId);
  if (runs.has(vault.vaultId)) return;
  const failures = failuresOf(attempt, false);
  if (attempt && failures > 0 && Date.now() < nextAutomaticTry(attempt, failures)) return;
  try {
    await runVaultBackup(vault, name, { automatic: true });
  } catch (error) {
    // Switched off while it ran: that is what was asked for, not a failure.
    if (error instanceof ZipStoppedError) return;
    toast.warning(i18n.t("mobile.backupZipFailed", { name }));
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
    /* no folder: this vault has never been archived on this device */
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
