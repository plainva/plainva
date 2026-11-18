import { useTranslation } from "react-i18next";
import { Button, useFullTextDamageNotice } from "@plainva/ui";
import { rebuildActiveIndexDatabase, type MobileVault } from "../services/vaultService";
import { useRebuildIndex } from "./useRebuildIndex";

/**
 * What the search says when it failed on a damaged full-text index
 * (`useSearchPages`'s `damaged`), with the strip's "Rebuild index" where only
 * that helps (`fullTextDamageNotice`) — the desktop's search says the same.
 */
export function FullTextDamageNotice({ vault, damaged }: { vault: MobileVault; damaged: boolean }) {
  const { t } = useTranslation();
  const notice = useFullTextDamageNotice(vault.db, damaged, async () => vault.isEncryptedWorkspace);
  const { rebuilding, rebuild } = useRebuildIndex(rebuildActiveIndexDatabase);
  if (!notice) return null;
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
