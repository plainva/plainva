import { awaitWholeIndex } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import {
  scanOkfConformance,
  type OkfConversionOptions,
  type OkfScanResult,
  type VaultQueryService,
} from "@plainva/core";
import { templateFolderKey } from "../contexts/VaultContext";
import {
  convertWithOkfJournal,
  undoWithOkfJournal,
  type OkfConversionAdapter,
  type OkfJournalStore,
  type OkfRollbackReport,
  type OkfRunRecipe,
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
  // The list of notes comes from the index: whole, or the conversion misses some (L3, as on the phone).
  await awaitWholeIndex({ vaultId: opts.vaultPath });
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
  type OkfRunRecipe,
  type OkfRollbackReport,
} from "@plainva/ui";
export type { OkfJournal };

/** Everything an interrupted run left behind, ready to continue or undo. */
export interface PendingOkfRun {
  journal: OkfJournal;
  /** How much of the vault still fails the conformance check right now. */
  remaining: number;
}

/** This vault's journal, in the shape the shared run asks for. */
function journalOf(vaultPath: string): OkfJournalStore {
  return {
    read: () => readOkfJournal(vaultPath),
    write: (journal) => writeOkfJournal({ ...journal, vaultPath }),
    clear: () => clearOkfJournal(vaultPath),
  };
}

/**
 * Runs the conversion with the journal around it (`convertWithOkfJournal`,
 * shared with the phone): journal first, then the first write.
 *
 * `resume` CONTINUES the open run — into its backup folder, with the options
 * its journal holds; a fresh run (`options`) is refused while one is open.
 * Notes the earlier pass converted are left alone: "rename" is not
 * idempotent, and a second pass wrote the converted text over the original's
 * backup (§ 3.129 Nr. 1).
 */
export async function convertVaultToOkf(opts: {
  vaultPath: string;
  adapter: OkfConversionAdapter;
  scan: OkfScanResult;
  options?: OkfConversionOptions;
  resume?: boolean;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  return convertWithOkfJournal({
    journal: journalOf(opts.vaultPath),
    adapter: opts.adapter,
    scan: opts.scan,
    options: opts.options,
    resume: opts.resume,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
  });
}

/**
 * Undoes a run from its backup folder and closes the journal — only where a
 * file still is what the run made of it (`rollbackOkfConversion`).
 */
export async function undoOkfConversion(
  vaultPath: string,
  adapter: OkfConversionAdapter,
  backupDir: string,
  recipe: OkfRunRecipe,
  onProgress?: (done: number, total: number) => void
): Promise<OkfRollbackReport> {
  return undoWithOkfJournal({ journal: journalOf(vaultPath), adapter, backupDir, recipe, onProgress });
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
