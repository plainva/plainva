import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "./ui/Banner";
import { indexBuildState, subscribeIndexBuild } from "../lib/indexBuild";

/**
 * The strip on top of the app while the index of the open vault is not whole
 * (issue 143 on the phone, performance plan L3 on the desktop). Search, tags,
 * backlinks, databases and the map answer from what has been read so far; this
 * is the sentence that says so, and how far it has come — or that the last full
 * read did not go through. It goes when the index is whole.
 */
export function IndexBuildNotice({ vaultId, className }: { vaultId: string | null | undefined; className?: string }) {
  const { t } = useTranslation();
  const read = useCallback(() => (vaultId ? indexBuildState(vaultId) : null), [vaultId]);
  const state = useSyncExternalStore(subscribeIndexBuild, read);
  if (!state || (state.kind !== "building" && state.kind !== "failed")) return null;
  return (
    <Banner className={className} kind={state.kind === "failed" ? "warning" : "info"}>
      <span data-testid="index-build-notice">
        {state.kind === "failed"
          ? t("mobile.indexBuildFailed")
          : state.total > 0
            ? t("mobile.indexBuilding", { done: state.done, total: state.total })
            : t("mobile.indexBuildingWalk")}
      </span>
    </Banner>
  );
}
