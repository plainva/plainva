import { getSettingsStore } from "./settingsStore";
import { scanOkfConformance, type OkfScanResult, type VaultQueryService } from "@plainva/core";
import { templateFolderKey } from "../contexts/VaultContext";
import type { OkfConversionAdapter } from "@plainva/ui";

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

// The run, re-exported so the desktop's existing imports keep working.
export {
  runOkfConversion,
  rollbackOkfConversion,
  type OkfConversionAdapter,
  type OkfConversionSample,
  type OkfRunReport,
  type OkfRollbackReport,
} from "@plainva/ui";
