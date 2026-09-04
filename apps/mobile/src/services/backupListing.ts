/**
 * What the vault detail may claim about the archive folder (C25).
 *
 * Measured on Android (finding 2026-08-25): after an uninstall+reinstall the
 * archives in the public Documents folder still exist, but they belong to the
 * old app UID — `readdir` returns an EMPTY list rather than an error. Read
 * naively, that empty list became "0 backups" on the vault page and "nothing
 * to prune" in the retention, while the files sat right there and kept
 * growing. The rule below turns that silence into a named state.
 *
 * The signal is deliberately narrow: the folder EXISTS, shows no archive, and
 * this installation has never written one (`lastRun === 0`). A folder this
 * installation created always holds the archive it was created for, and an
 * installation that has written before but finds the folder empty has simply
 * been emptied by hand — the next scheduled run refills it. Once detected, the
 * state is remembered until the user dismisses it: the first new archive
 * would otherwise make the count look right again while the old files stay
 * invisible and unpruned.
 */

export type UnreadableMark = "none" | "detected" | "dismissed";

export interface BackupListing {
  /** Archives this installation can read, newest first. */
  archives: string[];
  /**
   * The folder holds files this installation cannot see. Nothing is lost —
   * they are simply neither counted nor pruned from here.
   */
  unreadable: boolean;
}

export function classifyBackupListing(input: {
  folderExists: boolean;
  names: string[];
  /** Epoch ms of the last archive THIS installation wrote; 0 = never. */
  lastRun: number;
  remembered: UnreadableMark;
}): BackupListing {
  const archives = input.names.filter((n) => n.endsWith(".zip")).sort().reverse();
  if (input.remembered === "dismissed") return { archives, unreadable: false };
  const detectedNow = input.folderExists && archives.length === 0 && input.lastRun === 0;
  return { archives, unreadable: input.remembered === "detected" || detectedNow };
}
