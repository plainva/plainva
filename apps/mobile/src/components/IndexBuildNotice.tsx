import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, indexDatabaseRebuildOffered, type IndexDatabaseFailureKind } from "@plainva/ui";
import { getIndexBuild, subscribeIndexBuild } from "../services/indexBuild";
import { useRebuildIndex } from "./useRebuildIndex";

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
 *
 * Why the database did not open is said there too, in words, in every vault
 * (`indexDatabaseFailure`), and a damaged one outside an encrypted workspace
 * is offered to be built anew, asked first — the desktop's start offers the
 * same (`indexDatabaseRebuildOffered`).
 */
export function IndexBuildNotice({ vaultId, indexClosed = false, failure = null, onRebuild }: {
  vaultId: string;
  indexClosed?: boolean;
  failure?: { kind: IndexDatabaseFailureKind; workspace: boolean; message: string } | null;
  /** Sets the damaged database aside and opens the vault again (`rebuildActiveIndexDatabase`). */
  onRebuild?: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const build = useSyncExternalStore(subscribeIndexBuild, getIndexBuild);
  const { rebuilding, rebuild } = useRebuildIndex(onRebuild);
  if (failure || indexClosed) {
    const offered = !!failure && !!onRebuild && indexDatabaseRebuildOffered(failure.kind, failure.workspace);
    return (
      <Banner
        className="m-index-notice"
        kind="warning"
        actions={offered ? (
          <Button size="sm" onClick={() => { void rebuild(); }} disabled={rebuilding} data-testid="index-rebuild">
            {t("settings.rebuildIndexAction")}
          </Button>
        ) : undefined}
      >
        {failure ? <span data-testid="index-failure-notice">{failure.message} </span> : null}
        {indexClosed ? <span data-testid="index-closed-notice">{t("errors.indexClosedNotice")}</span> : null}
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
