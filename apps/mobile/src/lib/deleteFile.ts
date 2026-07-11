import type { TFunction } from "i18next";
import { mConfirm } from "../services/mobileDialogs";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * Confirm, then delete any vault file (note or `.base`) through the full sync
 * chain (`vaultOps.remove` is path-agnostic). Generic wording so it reads
 * correctly for both notes and databases. Shared by Browse / Today / Databases.
 */
export async function confirmDeleteFile(
  vault: MobileVault,
  path: string,
  title: string,
  t: TFunction,
): Promise<void> {
  const ok = await mConfirm({
    title: t("common.delete"),
    message: t("mobile.deleteNoteConfirm", { name: title }),
    danger: true,
    confirmLabel: t("common.delete"),
  });
  if (!ok) return;
  await vaultOps.remove(vault, path);
}
