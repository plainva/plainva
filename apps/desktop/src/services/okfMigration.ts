import { scanOkfVersionState, type OkfVersionState, type VaultQueryService } from "@plainva/core";
import type { OkfConversionAdapter } from "@plainva/ui";

/**
 * The desktop's half of the OKF bundle migration (OKF v0.2 plan, P2): finding
 * the candidates. The run itself (`runOkfMigration`) and the undo live in
 * `@plainva/ui` and are identical on both shells.
 *
 * Candidates come from the index: `properties` stores every frontmatter key of
 * every note, so the notes that still carry the legacy per-note `okf_version`
 * are one query away — instead of reading all notes of the vault to find the
 * thirty that matter. The root `index.md` is read directly by the scan.
 *
 * Deliberately NOT excluded: the template folder. A template that carries the
 * legacy key keeps stamping it into every note made from it (the placeholder
 * pass strips it since 2026-08-21, but the template file itself should be clean).
 */
export async function scanVaultOkfVersion(opts: {
  queryService: VaultQueryService;
  adapter: Pick<OkfConversionAdapter, "readTextFile">;
}): Promise<OkfVersionState> {
  const rows = await opts.queryService.db.query<{ path: string }>(
    `SELECT DISTINCT f.path AS path
     FROM properties p JOIN files f ON f.id = p.file_id
     WHERE p.key = 'okf_version' AND f.mode != 'attachment'`,
  );
  return scanOkfVersionState({
    paths: rows.map((r) => String(r.path).replace(/\\/g, "/")),
    readTextFile: (p) => opts.adapter.readTextFile(p),
  });
}

export {
  okfBundleStatusLines,
  okfVersionBreakdown,
  rollbackOkfConversion,
  runOkfMigration,
  type OkfRunReport,
  type OkfRollbackReport,
} from "@plainva/ui";
export { okfMigrationPending, type OkfVersionState } from "@plainva/core";
