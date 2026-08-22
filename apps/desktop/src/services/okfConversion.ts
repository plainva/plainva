import { getSettingsStore } from "./settingsStore";
import {
  scanOkfConformance,
  type OkfConversionOptions,
  type OkfScanResult,
  type VaultQueryService,
} from "@plainva/core";
import { templateFolderKey } from "../contexts/VaultContext";
import {
  rollbackOkfConversion,
  runOkfConversion,
  type OkfConversionAdapter,
  type OkfRollbackReport,
  type OkfRunReport,
} from "@plainva/ui";
import { clearOkfJournal, readOkfJournal, writeOkfJournal, type OkfJournal } from "./okfJournal";

/**
 * The desktop's half of the OKF conversion: turning this vault into a list of
 * paths. The run itself lives in `@plainva/ui` (lifted in P8) and is identical
 * on both shells; only the scan differs, because only this shell reads the
 * template folder out of the desktop settings store and the paths out of the
 * desktop index.
 */
export async function scanVaultOkf(opts: {
  vaultPath: string;
  queryService: VaultQueryService;
  adapter: Pick<OkfConversionAdapter, "readTextFile">;
}): Promise<OkfScanResult> {
  const store = await getSettingsStore();
  const templateFolder = (await store.get<string>(templateFolderKey(opts.vaultPath))) || "Templates";
  const rows = await opts.queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`
  );
  return scanOkfConformance({
    paths: rows.map((r) => r.path),
    readTextFile: (p) => opts.adapter.readTextFile(p),
    excludeFolders: [templateFolder],
  });
}

// The run itself, re-exported so existing imports keep working. Use it for DRY
// RUNS (the preview): a dry run changes nothing, so it needs no journal.
export {
  runOkfConversion,
  rollbackOkfConversion,
  type OkfConversionAdapter,
  type OkfConversionSample,
  type OkfRunReport,
  type OkfRollbackReport,
} from "@plainva/ui";
export type { OkfJournal };

/** Everything an interrupted run left behind, ready to continue or undo. */
export interface PendingOkfRun {
  journal: OkfJournal;
  /** How much of the vault still fails the conformance check right now. */
  remaining: number;
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
 * covers everything both passes touched. Two folders would mean two undos,
 * neither of which restores the vault on its own. Files the earlier pass
 * already converted come back `unchanged` — `convertFileToOkf` is idempotent,
 * which is what makes continuing safe at all.
 */
export async function convertVaultToOkf(opts: {
  vaultPath: string;
  adapter: OkfConversionAdapter;
  scan: OkfScanResult;
  options: OkfConversionOptions;
  backupDir?: string;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  const backupDir =
    opts.backupDir ?? `.plainva/backups/okf-conversion-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  await writeOkfJournal({
    startedAt: new Date().toISOString(),
    vaultPath: opts.vaultPath,
    backupDir,
    total: opts.scan.convertiblePaths.length,
    options: {
      defaultType: opts.options.defaultType,
      existingTypeStrategy: opts.options.existingTypeStrategy,
      renameTo: opts.options.renameTo,
    },
  });

  const report = await runOkfConversion({
    adapter: opts.adapter,
    scan: opts.scan,
    options: opts.options,
    backupDir,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
  });

  // A cancelled run keeps its journal: it IS the interrupted state the
  // recovery is for. Only a run that reached the end is done with it.
  if (!report.cancelled) await clearOkfJournal(opts.vaultPath);
  return report;
}

/**
 * Undoes a run from its backup folder and closes the journal.
 *
 * The journal is cleared only after a rollback that left nothing failed — a
 * partial restore must stay recoverable, so the next start offers it again.
 */
export async function undoOkfConversion(
  vaultPath: string,
  adapter: OkfConversionAdapter,
  backupDir: string,
  onProgress?: (done: number, total: number) => void
): Promise<OkfRollbackReport> {
  const report = await rollbackOkfConversion(adapter, backupDir, onProgress);
  if (report.failed.length === 0) await clearOkfJournal(vaultPath);
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
export async function pendingOkfRun(opts: {
  vaultPath: string;
  queryService: VaultQueryService;
  adapter: Pick<OkfConversionAdapter, "readTextFile">;
}): Promise<PendingOkfRun | null> {
  const journal = await readOkfJournal(opts.vaultPath);
  if (!journal) return null;
  try {
    const scan = await scanVaultOkf(opts);
    return { journal, remaining: scan.violations.length };
  } catch {
    return { journal, remaining: -1 };
  }
}
