import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, errorText, indexDatabaseRebuildOffered, toast } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";

/**
 * The start's "Rebuild index" for a damaged index database: a button under
 * the error, asked first, one run at a time. Its own module, loaded only when
 * a vault's index database failed, so the start screen's entry file carries
 * none of it.
 */
export const SplashRebuildIndex: React.FC = () => {
  const { t } = useTranslation();
  const { indexDatabaseFailure, rebuildIndexDatabase } = useVault();
  const [asked, setAsked] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const offered = !!indexDatabaseFailure && indexDatabaseRebuildOffered(indexDatabaseFailure.kind, indexDatabaseFailure.workspace);
  if (!offered) return null;

  const run = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      await rebuildIndexDatabase();
      setAsked(false);
    } catch (e) {
      toast.error(t("indexDatabase.rebuildFailed", { reason: errorText(e) }));
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "calc(-1 * var(--space-4))", marginBottom: "var(--space-6)" }}>
        <Button variant="primary" onClick={() => setAsked(true)} disabled={rebuilding} data-testid="splash-rebuild-index">
          {t("settings.rebuildIndexAction")}
        </Button>
      </div>
      {asked && (
        <Modal
          title={t("indexDatabase.rebuildTitle")}
          onClose={() => { if (!rebuilding) setAsked(false); }}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsked(false)} disabled={rebuilding}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={() => { void run(); }} disabled={rebuilding} data-testid="splash-rebuild-confirm">
                {t("settings.rebuildIndexAction")}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.5 }}>{t("indexDatabase.rebuildConfirm")}</p>
        </Modal>
      )}
    </>
  );
};
