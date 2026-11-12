import type { TFunction } from "i18next";
import { errorText, initialSelection, isBasePath, toast, isLargeDeletion, noteDisplayName, planNeedsDialog, selectedPaths } from "@plainva/ui";
import { isIndexNotWholeError } from "@plainva/core";
import { mCascade, mConfirm } from "../services/mobileDialogs";
import { buildMobileDeletionPlan, executeMobileCascade } from "../services/cascadeDelete";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { countVaultFiles } from "./folderDeletion";

/**
 * Confirm, then delete any vault file (note or `.base`) through the full sync
 * chain. Cascade-aware (plan Kaskadenloeschung): relation targets and `.base`
 * files open the cascade sheet (assigned elements, database rows, linked
 * databases); anything else keeps the slim confirm exactly as before. Shared
 * by Browse / Today / Databases / Note / Pinboard.
 */
const REFUSED = "refused" as const;

/**
 * The cascade plan, or the refusal where the index is not whole (performance
 * plan L3): its warnings — another database a note is part of, notes that go
 * with it — are read from the index, and a delete over half of one would go
 * without the warning it needs. Said, nothing deleted; as on the desktop.
 */
async function deletionPlanOrRefusal(vault: MobileVault, paths: string[]) {
  try {
    return await buildMobileDeletionPlan(vault, paths);
  } catch (e) {
    if (isIndexNotWholeError(e)) {
      toast.warning(errorText(e));
      return REFUSED;
    }
    return null;
  }
}

export async function confirmDeleteFile(
  vault: MobileVault,
  path: string,
  title: string,
  t: TFunction,
): Promise<boolean> {
  const plan = await deletionPlanOrRefusal(vault, [path]);
  if (plan === REFUSED) return false;

  if (plan && planNeedsDialog(plan)) {
    const sel = await mCascade({
      title: t(isBasePath(path) ? "cascade.titleBase" : "cascade.titleNote", { name: noteDisplayName(path) }),
      plan,
    });
    if (!sel) return false;
    // S4: a cascade can select far more than the note that was tapped, so it
    // asks the same second question the desktop does (E2 threshold). Mobile
    // skipped it entirely — the sheet's own count was the only warning.
    const count = selectedPaths(plan, sel).length;
    const total = await countVaultFiles(vault.queryService);
    if (isLargeDeletion(count, total)) {
      const sure = await mConfirm({
        title: t("dialogs.deleteLargeTitle"),
        message: t("dialogs.deleteLargeMsg", { count, total }),
        danger: true,
        confirmLabel: t("dialogs.deleteLargeConfirm"),
      });
      if (!sure) return false;
    }
    const result = await executeMobileCascade(vault, plan, sel);
    return result.deleted.length > 0;
  }

  const ok = await mConfirm({
    title: t("common.delete"),
    message: t("mobile.deleteNoteConfirm", { name: title }),
    danger: true,
    confirmLabel: t("common.delete"),
  });
  if (!ok) return false;
  if (plan) {
    // Trivial plan: the same single delete as before, but user-confirmed
    // paths are reported to the sync guard via the shared executor.
    const result = await executeMobileCascade(vault, plan, initialSelection(plan));
    return result.deleted.length > 0;
  }
  // False where the person kept it at "Delete without a backup?" (D1).
  return vaultOps.remove(vault, path, { confirmed: true });
}

/**
 * The same flow for SEVERAL files at once (plan Mehrfachauswahl, P4).
 *
 * Not a second implementation: the cascade planner has always taken an array —
 * the single-file path above simply passed one. What differs is the question,
 * because "delete Notiz X?" cannot be asked about eleven of them, and the
 * cascade sheet becomes the normal case rather than the exception.
 */
export async function confirmDeleteFiles(
  vault: MobileVault,
  paths: readonly string[],
  t: TFunction,
): Promise<string[]> {
  if (paths.length === 0) return [];
  if (paths.length === 1) {
    const ok = await confirmDeleteFile(vault, paths[0], noteDisplayName(paths[0]), t);
    return ok ? [paths[0]] : [];
  }

  const plan = await deletionPlanOrRefusal(vault, [...paths]);
  if (plan === REFUSED) return [];

  // Whatever the cascade adds, the person asked for these to go — so the
  // confirmation counts what will ACTUALLY be deleted, not what was tapped.
  if (plan && planNeedsDialog(plan)) {
    const sel = await mCascade({
      title: t("cascade.titleMany", { count: paths.length }),
      plan,
    });
    if (!sel) return [];
    const count = selectedPaths(plan, sel).length;
    const total = await countVaultFiles(vault.queryService);
    if (isLargeDeletion(count, total)) {
      const sure = await mConfirm({
        title: t("dialogs.deleteLargeTitle"),
        message: t("dialogs.deleteLargeMsg", { count, total }),
        danger: true,
        confirmLabel: t("dialogs.deleteLargeConfirm"),
      });
      if (!sure) return [];
    }
    const result = await executeMobileCascade(vault, plan, sel);
    return result.deleted;
  }

  const total = await countVaultFiles(vault.queryService);
  const ok = await mConfirm({
    title: t("common.delete"),
    message: t("dialogs.deleteLargeMsg", { count: paths.length, total }),
    danger: true,
    confirmLabel: t("common.delete"),
  });
  if (!ok) return [];
  if (plan) {
    const result = await executeMobileCascade(vault, plan, initialSelection(plan));
    return result.deleted;
  }
  const deleted: string[] = [];
  for (const p of paths) if (await vaultOps.remove(vault, p, { confirmed: true })) deleted.push(p);
  return deleted;
}
