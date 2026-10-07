import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { MobileVault } from "./vaultService";

/**
 * Drops the index and re-parses every file, and says how it went.
 *
 * One function for the Maintenance row and the palette's "rebuild the index"
 * command, so both end the same way: the index is invisible, and without a
 * word the user cannot tell a finished rebuild from a swallowed one. Resolves
 * to whether it finished — the screen re-reads its statistics on `true`.
 */
export async function rebuildVaultIndex(vault: MobileVault): Promise<boolean> {
  try {
    if (!vault.indexer) throw new Error("no indexer");
    await vault.indexer.indexVaultFull("index rebuild");
    toast.success(i18n.t("settings.rebuildIndexDone"));
    window.dispatchEvent(new CustomEvent("m-index-changed"));
    return true;
  } catch {
    toast.warning(i18n.t("settings.rebuildIndexFailed"));
    return false;
  }
}
