import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { atomicWriteText } from "../platform/atomicFile";

/**
 * The marker that says an OKF conversion is open (P8).
 *
 * A conversion writes into EVERY note of a vault, on a device that gets
 * cleared out of the background as a matter of course. Without a marker, a run
 * that dies at note 300 of 500 leaves a vault where some notes carry the OKF
 * fields and some do not — and nothing anywhere says so. The next start looks
 * completely normal.
 *
 * Two properties make this a journal rather than a variable, both borrowed
 * from the profile import journal, which solved the same problem for the
 * settings import:
 *
 * 1. It reaches the disk BEFORE the first change, through `atomicWriteText`
 *    (fsync on Android, F_FULLFSYNC on iOS, then a rename), so a process that
 *    dies mid-run leaves the marker behind. Deliberately not a preference:
 *    Capacitor writes those with `apply()`, which is asynchronous — at kill
 *    time it would not be there.
 * 2. It lives OUTSIDE the vault container, so a half state cannot travel to
 *    another device.
 *
 * What it does NOT carry is the list of converted files, and that is the
 * point: `runOkfConversion` copies a file's ORIGINAL content into the run's
 * backup folder immediately before overwriting it, so the backup folder
 * already IS the complete record of what changed. The journal only has to say
 * "a run is open, and its backups are here" — one write at the start, one
 * delete at the end, rather than a write per note.
 *
 * A word on what an interrupted run leaves behind: an incomplete vault, not a
 * broken one. The conversion adds frontmatter keys and never touches the body,
 * so every note is valid Markdown before and after. That is why the recovery
 * ASKS instead of rolling back on its own — continuing is usually what the
 * user wants — and why an open journal does not have to block the sync.
 */

export interface OkfJournal {
  startedAt: string;
  /** Vault-relative backup folder of the interrupted run. */
  backupDir: string;
  /** How many files the run set out to process, for the recovery wording. */
  total: number;
  /** The options the run started with, so continuing does not change its mind. */
  options: { defaultType: string; existingTypeStrategy?: "keep" | "rename"; renameTo?: string };
}

/** Beside the drafts and the profile journal — outside every vault container. */
export const okfJournalPath = (vaultId: string) => `okf-journal/${vaultId}.json`;

/**
 * Durable, before the first change.
 *
 * Throws on failure, and the caller must let it: a run without a journal is
 * exactly the run nobody can recover from, so "no journal, no run" is the
 * whole point (fail-closed).
 */
export async function writeOkfJournal(vaultId: string, journal: OkfJournal): Promise<void> {
  await atomicWriteText(okfJournalPath(vaultId), JSON.stringify(journal));
}

export async function clearOkfJournal(vaultId: string): Promise<void> {
  await Filesystem.deleteFile({ path: okfJournalPath(vaultId), directory: Directory.Data }).catch(() => {
    // Already gone, or never written — both mean there is nothing pending.
  });
}

export async function readOkfJournal(vaultId: string): Promise<OkfJournal | null> {
  try {
    const res = await Filesystem.readFile({
      path: okfJournalPath(vaultId),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(res.data)) as OkfJournal;
    // Without a backup folder there is nothing to roll back to and nothing to
    // continue into; treat such a journal as absent rather than offer a
    // recovery that cannot work.
    return parsed?.backupDir && parsed?.options?.defaultType ? parsed : null;
  } catch {
    return null;
  }
}
