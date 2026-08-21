import { scanOkfConformance, type OkfConversionOptions, type OkfScanResult } from "@plainva/core";
import {
  rollbackOkfConversion,
  runOkfConversion,
  type OkfRollbackReport,
  type OkfRunReport,
} from "@plainva/ui";
import { getVaultSettings } from "./mobileSettings";
import { clearOkfJournal, readOkfJournal, writeOkfJournal, type OkfJournal } from "./okfJournal";
import type { MobileVault } from "./vaultService";

/**
 * The phone's half of the OKF conversion (P8).
 *
 * The run and the rollback are shared with the desktop; what lives here is the
 * scan (which reads the template folder from the mobile settings and the paths
 * from this vault's index) and the safety net around the run, which the phone
 * needs and the desktop so far does without: a journal written before the
 * first change, and a recovery that finds it on the next start.
 */

export type { OkfRunReport, OkfRollbackReport, OkfJournal };

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
  const rows = await vault.queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`,
  );
  return scanOkfConformance({
    paths: rows.map((r) => r.path),
    readTextFile: (p) => vault.files.readTextFile(p),
    excludeFolders: await excludedFolders(vault.vaultId),
  });
}

/**
 * Runs the conversion with the journal around it.
 *
 * The order is the whole point: journal first, then the first write. A journal
 * that cannot be written aborts the run — a conversion nobody could recover
 * from is worse than one that never started.
 *
 * `backupDir` may be handed in to CONTINUE an interrupted run: the new pass
 * then keeps writing its backups into the same folder, so one undo still
 * covers everything both passes touched. Files the earlier pass already
 * converted come back `unchanged` — `convertFileToOkf` is idempotent, which is
 * what makes continuing safe at all.
 */
export async function convertVaultToOkf(opts: {
  vault: MobileVault;
  scan: OkfScanResult;
  options: OkfConversionOptions;
  backupDir?: string;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  const { vault, scan, options } = opts;
  const backupDir =
    opts.backupDir ?? `.plainva/backups/okf-conversion-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  await writeOkfJournal(vault.vaultId, {
    startedAt: new Date().toISOString(),
    backupDir,
    total: scan.convertiblePaths.length,
    options: {
      defaultType: options.defaultType,
      existingTypeStrategy: options.existingTypeStrategy,
      renameTo: options.renameTo,
    },
  });

  const report = await runOkfConversion({
    adapter: vault.files,
    scan,
    options,
    backupDir,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
    // One file at a time. The desktop overlaps eight, which is right for a
    // network drive; here the writes go through the sync queue and the
    // snapshot chain on a device whose main thread also draws the progress —
    // and a paused run should stop at a known point, not eight of them.
    concurrency: 1,
  });

  // A cancelled run keeps its journal: it IS the interrupted state the
  // recovery is for. Only a run that reached the end is done with it.
  if (!report.cancelled) await clearOkfJournal(vault.vaultId);
  return report;
}

/**
 * Undoes a run from its backup folder and closes the journal.
 *
 * The journal is cleared only after a rollback that left nothing failed — a
 * partial restore must stay recoverable, so the next start offers it again.
 */
export async function undoOkfConversion(
  vault: MobileVault,
  backupDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<OkfRollbackReport> {
  const report = await rollbackOkfConversion(vault.files, backupDir, onProgress);
  if (report.failed.length === 0) await clearOkfJournal(vault.vaultId);
  return report;
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
