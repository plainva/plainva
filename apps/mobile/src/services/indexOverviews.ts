import {
  folderIndexState,
  generateIndexForFolder,
  toast,
  type FolderIndexState,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getActiveVaultEntry } from "./vaultRegistry";
import type { MobileVault } from "./vaultService";

/**
 * Generating and refreshing the OKF overviews (index.md) from the phone (P6).
 *
 * The generator itself is shared with the desktop; what lives here is the
 * heading rule and the reporting, so the folder sheet, the overviews list and
 * the read-only banner all produce the same file rather than three variants.
 * The root's heading is the vault's name, a folder's is its own — same as the
 * desktop, which is what makes an overview written here indistinguishable from
 * one written there.
 */

export type { FolderIndexState };

/** What the folder's overview is right now — absent, ours, or the user's. */
export async function overviewState(v: MobileVault, folder: string): Promise<FolderIndexState> {
  return folderIndexState(v.files, folder);
}

/**
 * Writes the folder's overview and reports it.
 *
 * Returns the path so callers can open it; throws are left to the caller,
 * which knows whether it is a single tap or one row of a longer run.
 */
export async function writeOverview(v: MobileVault, folder: string): Promise<{ path: string; entries: number; overwrote: boolean }> {
  if (!v.queryService) throw new Error("no index");
  const heading = folder === "" ? (await getActiveVaultEntry()).name || "Plainva" : folder.split("/").pop()!;
  const result = await generateIndexForFolder({
    adapter: v.files,
    queryService: v.queryService,
    folder,
    heading,
    subfoldersHeading: i18n.t("indexMd.subfoldersHeading"),
  });
  // Index and tree first — the note screen may be showing this very file.
  await v.reindexPaths([result.indexPath]).catch(() => {});
  window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path: result.indexPath } }));
  window.dispatchEvent(new CustomEvent("m-vault-changed"));
  return { path: result.indexPath, entries: result.entries, overwrote: result.overwrote };
}

/** The folder-sheet tap: writes, then says which of the two things it did. */
export async function generateOverviewForFolder(v: MobileVault, folder: string): Promise<void> {
  try {
    const r = await writeOverview(v, folder);
    toast.success(
      r.overwrote
        ? i18n.t("indexMd.resultUpdated", { entries: r.entries })
        : i18n.t("indexMd.resultCreated", { entries: r.entries }),
    );
  } catch (e) {
    console.error("[mobile] index.md generation failed", e);
    toast.error(i18n.t("indexMd.generateFailed"));
  }
}
