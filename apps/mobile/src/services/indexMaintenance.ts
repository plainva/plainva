import { errorText, indexDatabaseFailureKind, indexFailureSaid, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { mConfirm } from "./mobileDialogs";
import type { MobileVault } from "./vaultService";

/**
 * Reads every file of the vault again, and says how it went.
 *
 * The way is the core's, the same as the desktop's (`VaultIndexer.rebuildIndex`):
 * every file is read, whatever its timestamp says, and what cannot be read
 * again — creation times, sync labels, merge bases — stays. This ran the
 * ordinary scan before, which reads only what changed by its timestamp: a
 * note indexed wrongly under a timestamp that matched stayed as it was, the
 * one thing the button is for (finding 2026-10-12).
 *
 * One function for the Maintenance row and the palette's "rebuild the index"
 * command, so both end the same way: the index is invisible, and without a
 * word the user cannot tell a finished rebuild from a swallowed one. Resolves
 * to whether it finished — the screen re-reads its statistics on `true`.
 */
export async function rebuildVaultIndex(
  vault: Pick<MobileVault, "indexer"> & { isEncryptedWorkspace?: boolean },
  rebuildDatabase: () => Promise<boolean> = async () => (await import("./vaultService")).rebuildOpenMobileIndexDatabase(),
): Promise<boolean> {
  try {
    if (!vault.indexer) throw new Error("no indexer");
    await vault.indexer.rebuildIndex("index rebuild");
    toast.success(i18n.t("settings.rebuildIndexDone"));
    window.dispatchEvent(new CustomEvent("m-index-changed"));
    return true;
  } catch (e) {
    // Reading everything again cannot heal the database itself: where that is
    // what failed, the strip's way of setting it aside is offered, asked first
    // — never in an encrypted workspace, nor where that is not said.
    if (indexDatabaseFailureKind(e) === "damaged" && vault.isEncryptedWorkspace === false) {
      const yes = await mConfirm({ title: i18n.t("indexDatabase.rebuildTitle"), message: i18n.t("indexDatabase.rebuildConfirm"), confirmLabel: i18n.t("settings.rebuildIndexAction") });
      if (yes) await rebuildDatabase().catch((error: unknown) => toast.error(i18n.t("indexDatabase.rebuildFailed", { reason: errorText(error) })));
      return false;
    }
    // One notice for one failure: a scan that failed has named its reason
    // already (Sammelplan § 3.94).
    if (!indexFailureSaid(e)) toast.warning(i18n.t("settings.rebuildIndexFailed"));
    return false;
  }
}
