import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, errorText, toast } from "@plainva/ui";

/**
 * "Rebuild index" for a damaged index database, asked first, one run at a
 * time: the start's (a vault whose database did not open) and the search's (an
 * open vault whose full-text index could not be made anew). One question for
 * both — what is lost is the same.
 */
export const RebuildIndexButton: React.FC<{ onRebuild: () => Promise<void>; testId: string }> = ({ onRebuild, testId }) => {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const run = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      await onRebuild();
      setAsked(false);
    } catch (e) {
      toast.error(t("indexDatabase.rebuildFailed", { reason: errorText(e) }));
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <>
      <Button variant="primary" onClick={() => setAsked(true)} disabled={rebuilding} data-testid={testId}>
        {t("settings.rebuildIndexAction")}
      </Button>
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
              <Button variant="primary" onClick={() => { void run(); }} disabled={rebuilding} data-testid={`${testId}-confirm`}>
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
