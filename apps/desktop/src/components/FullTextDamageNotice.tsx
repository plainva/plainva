import React from "react";
import { useTranslation } from "react-i18next";
import { useFullTextDamageNotice, type FullTextDamageNotice as Notice } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { isOwnerWindow } from "../services/windowContext";
import { RebuildIndexButton } from "./RebuildIndexButton";

/**
 * Whether a failed search failed on a damaged full-text index, as the index
 * database's note says (`useFullTextDamageNotice`). Null: an ordinary
 * failure, which the surface offers to try again.
 */
export function useSearchDamageNotice(search: { failed: boolean; damaged: boolean }): Notice | null {
  const { dbAdapter, indexRebuildWorkspace } = useVault();
  return useFullTextDamageNotice(dbAdapter, search.failed, search.damaged, indexRebuildWorkspace);
}

/**
 * What a search says when it failed on a damaged full-text index, with the
 * start's "Rebuild index" where only that helps (`fullTextDamageNotice`). The
 * button lives in the window that owns the vault; an auxiliary window says
 * the same sentence without it.
 */
export const FullTextDamageNotice: React.FC<{ notice: Notice }> = ({ notice }) => {
  const { t } = useTranslation();
  const { rebuildDamagedIndexDatabase } = useVault();
  return (
    <div role="status" data-testid="full-text-damage-notice">
      <p>{t(notice.textKey, { action: t("settings.rebuildIndexAction") })}</p>
      {notice.offerRebuild && isOwnerWindow() && (
        <RebuildIndexButton onRebuild={async () => { await rebuildDamagedIndexDatabase(); }} testId="search-rebuild-index" />
      )}
    </div>
  );
};
