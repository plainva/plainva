import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "./ui/Banner";
import { getIndexBuild, subscribeIndexBuild } from "../lib/indexBuild";

/**
 * The strip on top of the app while the first index of the open vault is
 * built behind it (issue 143 on the phone, performance plan L3 on the
 * desktop). Search, tags, backlinks, databases and the map answer from what
 * has been read so far; this is the sentence that says so, and how far it has
 * come. It goes when the index is whole.
 */
export function IndexBuildNotice({ vaultId, className }: { vaultId: string | null | undefined; className?: string }) {
  const { t } = useTranslation();
  const build = useSyncExternalStore(subscribeIndexBuild, getIndexBuild);
  if (!build || !vaultId || build.vaultId !== vaultId) return null;
  return (
    <Banner className={className} kind="info">
      <span data-testid="index-build-notice">
        {build.total > 0
          ? t("mobile.indexBuilding", { done: build.done, total: build.total })
          : t("mobile.indexBuildingWalk")}
      </span>
    </Banner>
  );
}
