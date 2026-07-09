import { appConfirm } from "./appDialogs";

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

/** E2 threshold: >10 affected files OR (>1 file AND >20% of the vault). */
export function isLargeDeletion(fileCount: number, vaultFileCount: number): boolean {
  if (fileCount > 10) return true;
  // A single file never needs the second prompt, even in a tiny vault.
  return fileCount > 1 && vaultFileCount > 0 && fileCount > vaultFileCount * 0.2;
}

/** Files (not folders) affected by deleting `roots`, incl. folder children. */
export function countAffectedFiles(
  files: ReadonlyArray<{ path: string; isDir?: boolean }>,
  roots: string[]
): number {
  const norm = roots.map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""));
  let n = 0;
  for (const f of files) {
    if (f.isDir) continue;
    const p = f.path.replace(/\\/g, "/");
    if (norm.some((r) => p === r || p.startsWith(r + "/"))) n++;
  }
  return n;
}

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

  return appConfirm({
    title: t("dialogs.deleteLargeTitle"),
    message: t(opts.syncActive ? "dialogs.deleteLargeMsgSynced" : "dialogs.deleteLargeMsg", {
      count: opts.fileCount,
      total: opts.vaultFileCount,
    }),
    kind: "danger",
    confirmLabel: t("dialogs.deleteLargeConfirm"),
  });
}
