import { scanOkfConformance, type OkfConversionOptions, type OkfScanResult } from "@plainva/core";
import {
  convertWithOkfJournal,
  undoWithOkfJournal,
  type OkfJournalStore,
  type OkfRollbackReport,
  type OkfRunRecipe,
  type OkfRunReport,
} from "@plainva/ui";
import { getVaultSettings } from "./mobileSettings";
import { clearOkfJournal, readOkfJournal, writeOkfJournal, type OkfJournal } from "./okfJournal";
import type { MobileVault } from "./vaultService";
import { awaitWholeIndex } from "./indexBuild";

/**
 * The phone's half of the OKF conversion (P8).
 *
 * The run and the rollback are shared with the desktop; what lives here is the
 * scan (which reads the template folder from the mobile settings and the paths
 * from this vault's index) and the safety net around the run, which the phone
 * needs and the desktop so far does without: a journal written before the
 * first change, and a recovery that finds it on the next start.
 */

export type { OkfRunReport, OkfRollbackReport, OkfRunRecipe, OkfJournal };

/** Everything an interrupted run left behind, ready to continue or undo. */
export interface PendingOkfRun {
  journal: OkfJournal;
  /** How much of the vault still fails the conformance check right now. */
  remaining: number;
}

async function excludedFolders(vaultId: string): Promise<string[]> {
  const settings = await getVaultSettings(vaultId);
  return [settings.templateFolder || "Templates"];
}

/**
 * What this vault looks like against the three hard OKF rules.
 *
 * Reads every note through the adapter rather than the index, because the
 * index stores no frontmatter body — the same route the desktop takes.
 */
export async function scanVaultOkf(vault: MobileVault): Promise<OkfScanResult> {
  if (!vault.queryService) throw new Error("no index");
  // The list of notes comes from the index: whole, or the conversion misses some (issue 143).
  await awaitWholeIndex(vault);
  const rows = await vault.queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`,
  );
  return scanOkfConformance({
    paths: rows.map((r) => r.path),
    readTextFile: (p) => vault.files.readTextFile(p),
    excludeFolders: await excludedFolders(vault.vaultId),
  });
}

/** This vault's journal, in the shape the shared run asks for. */
function journalOf(vaultId: string): OkfJournalStore {
  return {
    read: () => readOkfJournal(vaultId),
    write: (journal) => writeOkfJournal(vaultId, journal),
    clear: () => clearOkfJournal(vaultId),
  };
}

/**
 * Runs the conversion with the journal around it (`convertWithOkfJournal`,
 * shared with the desktop): journal first, then the first write.
 *
 * `resume` CONTINUES the open run — into its backup folder, with the options
 * its journal holds, whatever the screen shows; a fresh run (`options`) is
 * refused while one is open, so no way back to the preview can start a second
 * backup folder. Notes the earlier pass converted are left alone: "rename" is
 * not idempotent (§ 3.129 Nr. 1).
 */
export async function convertVaultToOkf(opts: {
  vault: MobileVault;
  scan: OkfScanResult;
  options?: OkfConversionOptions;
  resume?: boolean;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  return convertWithOkfJournal({
    journal: journalOf(opts.vault.vaultId),
    adapter: opts.vault.files,
    scan: opts.scan,
    options: opts.options,
    resume: opts.resume,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
    // One file at a time. The desktop overlaps eight, which is right for a
    // network drive; here the writes go through the sync queue and the
    // snapshot chain on a device whose main thread also draws the progress —
    // and a paused run should stop at a known point, not eight of them.
    concurrency: 1,
  });
}

/**
 * Undoes a run from its backup folder and closes the journal — only where a
 * file still is what the run made of it (`rollbackOkfConversion`).
 */
export async function undoOkfConversion(
  vault: MobileVault,
  backupDir: string,
  recipe: OkfRunRecipe,
  onProgress?: (done: number, total: number) => void,
): Promise<OkfRollbackReport> {
  return undoWithOkfJournal({ journal: journalOf(vault.vaultId), adapter: vault.files, backupDir, recipe, onProgress });
}

/**
 * The interrupted run this vault is carrying, if any.
 *
 * Also counts what still fails the check, so the recovery can say how much is
 * left rather than only that something happened. A scan that throws (no index
 * yet at start-up) is not a reason to hide the journal — the run is reported
 * with `remaining: -1` and the surface simply says less.
 */
export async function pendingOkfRun(vault: MobileVault): Promise<PendingOkfRun | null> {
  const journal = await readOkfJournal(vault.vaultId);
  if (!journal) return null;
  try {
    const scan = await scanVaultOkf(vault);
    return { journal, remaining: scan.violations.length };
  } catch {
    return { journal, remaining: -1 };
  }
}
