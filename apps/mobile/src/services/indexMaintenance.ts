import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
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
export async function rebuildVaultIndex(vault: Pick<MobileVault, "indexer">): Promise<boolean> {
  try {
    if (!vault.indexer) throw new Error("no indexer");
    await vault.indexer.rebuildIndex("index rebuild");
    toast.success(i18n.t("settings.rebuildIndexDone"));
    window.dispatchEvent(new CustomEvent("m-index-changed"));
    return true;
  } catch {
    toast.warning(i18n.t("settings.rebuildIndexFailed"));
    return false;
  }
}
