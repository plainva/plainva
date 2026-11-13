import { useTranslation } from "react-i18next";
import { Banner, IndexBuildNotice as SharedIndexBuildNotice } from "@plainva/ui";

/**
 * The strip on top of the app while the first index of the open vault is
 * built behind it (issue 143). The strip is shared with the desktop
 * (performance plan L3); the phone gives it its place under the status bar.
 *
 * The same place says it when there is no index at all (stability plan R5):
 * the vault's database did not open, and deleting, renaming and moving are
 * refused until it does (`StructureRefusingVaultAdapter`) — said up front,
 * so nobody tries, fails and guesses.
 */
export function IndexBuildNotice({ vaultId, indexClosed = false }: { vaultId: string; indexClosed?: boolean }) {
  const { t } = useTranslation();
  if (indexClosed) {
    return (
      <Banner className="m-index-notice" kind="warning">
        <span data-testid="index-closed-notice">{t("errors.indexClosedNotice")}</span>
      </Banner>
    );
  }
  return <SharedIndexBuildNotice vaultId={vaultId} className="m-index-notice" />;
}
