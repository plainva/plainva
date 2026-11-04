import {
  errorText,
  folderIndexState,
  generateIndexForFolder,
  newOverviewPlacements,
  pinLinksBeforeOverviews,
  toast,
  withPinnedLinks,
  type FolderIndexState,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { mConfirmOption } from "./mobileDialogs";
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

/**
 * Before overviews are generated in `folders` (P21, maintainer 03.11.): a new
 * index.md takes over a link that names another folder's overview only as
 * `index`. Where that would happen, the sheet asks — counted, preset — to
 * write such links with their folder first, as the adoption sheet and the
 * desktop ask (`pinLinksBeforeOverviews`); where nothing would, nothing is
 * asked. `null`: the question was cancelled, and nothing is generated.
 */
export async function pinLinksBeforeNewOverviews(
  v: MobileVault,
  folders: readonly string[],
  question: { title: string; confirmLabel?: string },
): Promise<{ pinned: number } | null> {
  if (!v.queryService) return { pinned: 0 };
  const done = await pinLinksBeforeOverviews({
    queryService: v.queryService,
    adapter: v.files,
    placements: newOverviewPlacements(folders),
    ask: async (links) => {
      const answer = await mConfirmOption({
        title: question.title,
        message: i18n.t(folders.length > 1 ? "indexMd.pinHintMany" : "indexMd.pinHint"),
        confirmLabel: question.confirmLabel,
        checkbox: { label: i18n.t("indexMd.pinOption", { links }), initial: true },
      });
      return answer.confirmed ? answer.checked : null;
    },
    changed: (path) => window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path, vaultId: v.vaultId } })),
  });
  if (done?.failed) toast.warning(i18n.t("indexMd.pinFailed"));
  return done;
}

/** The folder-sheet tap: writes, then says which of the two things it did. */
export async function generateOverviewForFolder(v: MobileVault, folder: string): Promise<void> {
  try {
    const pins = await pinLinksBeforeNewOverviews(v, [folder], { title: i18n.t("indexMd.createOverview"), confirmLabel: i18n.t("indexMd.createOverview") });
    if (!pins) return;
    const r = await writeOverview(v, folder);
    const did = i18n.t(r.overwrote ? "indexMd.resultUpdated" : "indexMd.resultCreated", { entries: r.entries });
    toast.success(withPinnedLinks(i18n.t, did, pins.pinned));
  } catch (e) {
    console.error("[mobile] index.md generation failed", e);
    toast.error(i18n.t("writeFailed.overview", { reason: errorText(e) }));
  }
}
