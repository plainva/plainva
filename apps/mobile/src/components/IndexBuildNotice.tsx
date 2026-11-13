import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "@plainva/ui";
import { getIndexBuild, subscribeIndexBuild } from "../services/indexBuild";

/**
 * The strip on top of the app while the first index of the open vault is
 * built behind it (issue 143). Search, tags, backlinks, databases and the map
 * answer from what has been read so far; this is the sentence that says so,
 * and how far it has come. It goes when the index is whole.
 *
 * The same strip says it when there is no index at all (stability plan R5):
 * the vault's database did not open, and deleting, renaming and moving are
 * refused until it does (`StructureRefusingVaultAdapter`) — said up front,
 * so nobody tries, fails and guesses.
 */
export function IndexBuildNotice({ vaultId, indexClosed = false }: { vaultId: string; indexClosed?: boolean }) {
  const { t } = useTranslation();
  const build = useSyncExternalStore(subscribeIndexBuild, getIndexBuild);
  if (indexClosed) {
    return (
      <Banner className="m-index-notice" kind="warning">
        <span data-testid="index-closed-notice">{t("errors.indexClosedNotice")}</span>
      </Banner>
    );
  }
  if (!build || build.vaultId !== vaultId) return null;
  return (
    <Banner className="m-index-notice" kind="info">
      <span data-testid="index-build-notice">
        {build.total > 0
          ? t("mobile.indexBuilding", { done: build.done, total: build.total })
          : t("mobile.indexBuildingWalk")}
      </span>
    </Banner>
  );
}
