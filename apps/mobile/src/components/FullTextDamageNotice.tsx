import { useTranslation } from "react-i18next";
import { Button, useFullTextDamageNotice, type FullTextDamageNotice as Notice } from "@plainva/ui";
import { rebuildActiveIndexDatabase, type MobileVault } from "../services/vaultService";
import { useRebuildIndex } from "./useRebuildIndex";

/**
 * Whether a failed search failed on a damaged full-text index, as the index
 * database's note says (`useFullTextDamageNotice`). Null: an ordinary
 * failure, which the search offers to try again.
 */
export function useSearchDamageNotice(vault: MobileVault, search: { failed: boolean; damaged: boolean }): Notice | null {
  return useFullTextDamageNotice(vault.db, search.failed, search.damaged, async () => vault.isEncryptedWorkspace);
}

/**
 * What the search says when it failed on a damaged full-text index, with the
 * strip's "Rebuild index" where only that helps (`fullTextDamageNotice`) — the
 * desktop's search says the same.
 */
export function FullTextDamageNotice({ notice }: { notice: Notice }) {
  const { t } = useTranslation();
  const { rebuilding, rebuild } = useRebuildIndex(rebuildActiveIndexDatabase);
  return (
    <div role="status" data-testid="full-text-damage-notice">
      <p>{t(notice.textKey, { action: t("settings.rebuildIndexAction") })}</p>
      {notice.offerRebuild && (
        <Button onClick={() => { void rebuild(); }} disabled={rebuilding} data-testid="search-rebuild-index" variant="tonal">
          {t("settings.rebuildIndexAction")}
        </Button>
      )}
    </div>
  );
}
