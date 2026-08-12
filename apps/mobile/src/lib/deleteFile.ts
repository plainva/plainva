import type { TFunction } from "i18next";
import { initialSelection, isBasePath, isLargeDeletion, noteDisplayName, planNeedsDialog, selectedPaths } from "@plainva/ui";
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
export async function confirmDeleteFile(
  vault: MobileVault,
  path: string,
  title: string,
  t: TFunction,
): Promise<boolean> {
  const plan = await buildMobileDeletionPlan(vault, [path]).catch(() => null);

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
  await vaultOps.remove(vault, path);
  return true;
}
