import React from "react";
import { useTranslation } from "react-i18next";
import { useFullTextDamageNotice } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { isOwnerWindow } from "../services/windowContext";
import { RebuildIndexButton } from "./RebuildIndexButton";

/**
 * What a search says when it failed on a damaged full-text index
 * (`useSearchPages`'s `damaged`), with the start's "Rebuild index" where only
 * that helps (`fullTextDamageNotice`). The button lives in the window that
 * owns the vault; an auxiliary window says the same sentence without it.
 */
export const FullTextDamageNotice: React.FC<{ damaged: boolean }> = ({ damaged }) => {
  const { t } = useTranslation();
  const { dbAdapter, indexRebuildWorkspace, rebuildDamagedIndexDatabase } = useVault();
  const notice = useFullTextDamageNotice(dbAdapter, damaged, indexRebuildWorkspace);
  if (!notice) return null;
  return (
    <div role="status" data-testid="full-text-damage-notice">
      <p>{t(notice.textKey, { action: t("settings.rebuildIndexAction") })}</p>
      {notice.offerRebuild && isOwnerWindow() && (
        <RebuildIndexButton onRebuild={async () => { await rebuildDamagedIndexDatabase(); }} testId="search-rebuild-index" />
      )}
    </div>
  );
};
