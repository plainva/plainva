import { scanOkfVersionState, type OkfVersionState } from "@plainva/core";
import {
  rollbackOkfConversion,
  runOkfMigration,
  type OkfRollbackReport,
  type OkfRunReport,
} from "@plainva/ui";
import type { MobileVault } from "./vaultService";

/**
 * The phone's half of the OKF bundle migration (OKF v0.2 plan, P2).
 *
 * The scan, the run and the undo are the shared ones. Unlike the conversion
 * (P8) there is deliberately NO journal around this run: every edit it makes
 * is idempotent and reversible from the backup folder, a half-finished run
 * leaves the vault in a state that is valid per spec (a root still on 0.1, a
 * few notes still carrying the key — exactly what the row in Maintenance shows
 * afterwards), and the next scan simply offers the rest. A marker that forces
 * a question at start-up is for runs whose half state is invisible; this one
 * is visible.
 */

export type { OkfRunReport, OkfRollbackReport, OkfVersionState };

/**
 * Candidates come from the index (`properties` stores every frontmatter key),
 * the root index.md is read directly by the scan.
 */
export async function scanVaultOkfVersion(vault: MobileVault): Promise<OkfVersionState> {
  if (!vault.queryService) throw new Error("no index");
  const rows = await vault.queryService.db.query<{ path: string }>(
    `SELECT DISTINCT f.path AS path
     FROM properties p JOIN files f ON f.id = p.file_id
     WHERE p.key = 'okf_version' AND f.mode != 'attachment'`,
  );
  return scanOkfVersionState({
    paths: rows.map((r) => String(r.path).replace(/\\/g, "/")),
    readTextFile: (p) => vault.files.readTextFile(p),
  });
}

export async function migrateVaultOkf(opts: {
  vault: MobileVault;
  state: OkfVersionState;
  stripNoteVersion: boolean;
  onProgress?: (done: number, total: number, path: string) => void;
  isCancelled?: () => boolean;
}): Promise<OkfRunReport> {
  return runOkfMigration({
    adapter: opts.vault.files,
    state: opts.state,
    stripNoteVersion: opts.stripNoteVersion,
    onProgress: opts.onProgress,
    isCancelled: opts.isCancelled,
    // One file at a time, like the conversion: the writes go through the sync
    // queue and the snapshot chain on a device whose main thread also draws
    // the progress — and a paused run should stop at a known point.
    concurrency: 1,
  });
}

/** Undoes a run from its backup folder — the same undo the conversion has. */
export async function undoOkfMigration(
  vault: MobileVault,
  backupDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<OkfRollbackReport> {
  return rollbackOkfConversion(vault.files, backupDir, onProgress);
}
