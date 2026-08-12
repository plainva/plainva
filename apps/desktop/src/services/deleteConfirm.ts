import { appConfirm } from "./appDialogs";
import { countAffectedFiles, isLargeDeletion } from "@plainva/ui";

// The threshold and the counting live in @plainva/ui since S4 — mobile asks
// the same question and used to answer it with a drifted copy. Re-exported
// here so the desktop's call sites and tests keep their import.
export { countAffectedFiles, isLargeDeletion };

/**
 * Shared deletion confirmation for the file tree (single + bulk) and the
 * editor's ⋮ menu. One dialog as before (now naming the cloud when a sync
 * target is connected), plus a SECOND, sharper prompt for large deletions —
 * maintainer decision E2 (2026-07-09): more than 10 affected files OR more
 * than 20% of the vault. Cancelling either prompt deletes nothing. After a
 * fully confirmed deletion the caller reports the paths to the sync worker
 * (noteUserInitiatedDeletion) so the mass-deletion guard does not hold — and
 * on "restore" resurrect — a deliberate deletion.
 */

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export async function confirmDeletion(opts: {
  t: Translate;
  /** Single-target dialog data; omit for the bulk wording. */
  single?: { name: string; isFolder: boolean };
  /** Bulk mode: number of selected roots (shown in the first dialog). */
  rootCount?: number;
  /** Files affected by the deletion, incl. children of deleted folders. */
  fileCount: number;
  /** All files in the vault — the base for the 20% threshold. */
  vaultFileCount: number;
  /** Adds the cloud note + sharper large-deletion wording. */
  syncActive: boolean;
}): Promise<boolean> {
  const { t } = opts;
  const base = opts.single
    ? t("dialogs.deleteConfirmMsg", {
        kind: opts.single.isFolder ? t("dialogs.folderKind") : t("dialogs.fileKind"),
        name: opts.single.name,
      })
    : t("dialogs.deleteManyConfirmMsg", { count: opts.rootCount ?? opts.fileCount });
  const message = opts.syncActive ? `${base}\n\n${t("dialogs.deleteSyncNote")}` : base;
  const ok = await appConfirm({
    title: t("dialogs.deleteConfirmTitle"),
    message,
    kind: "danger",
    confirmLabel: t("common.delete", { defaultValue: "Delete" }),
  });
  if (!ok) return false;
  if (!isLargeDeletion(opts.fileCount, opts.vaultFileCount)) return true;
  return confirmLargeDeletion(t, opts.fileCount, opts.vaultFileCount, opts.syncActive);
}

/** The sharper second prompt alone — the cascade dialog reuses it unchanged. */
export async function confirmLargeDeletion(
  t: Translate,
  fileCount: number,
  vaultFileCount: number,
  syncActive: boolean
): Promise<boolean> {
  return appConfirm({
    title: t("dialogs.deleteLargeTitle"),
    message: t(syncActive ? "dialogs.deleteLargeMsgSynced" : "dialogs.deleteLargeMsg", {
      count: fileCount,
      total: vaultFileCount,
    }),
    kind: "danger",
    confirmLabel: t("dialogs.deleteLargeConfirm"),
  });
}
