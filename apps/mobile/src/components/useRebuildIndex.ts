import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText, toast } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";

/**
 * "Rebuild index" for a damaged index database, asked first, one run at a
 * time: the strip's (a database that did not open) and the search's (an open
 * vault whose full-text index could not be made anew). One question for both
 * — what is lost is the same.
 */
export function useRebuildIndex(onRebuild?: () => Promise<unknown>) {
  const { t } = useTranslation();
  const [rebuilding, setRebuilding] = useState(false);
  const rebuild = async () => {
    if (rebuilding || !onRebuild) return;
    const yes = await mConfirm({ title: t("indexDatabase.rebuildTitle"), message: t("indexDatabase.rebuildConfirm"), confirmLabel: t("settings.rebuildIndexAction") });
    if (!yes) return;
    setRebuilding(true);
    try {
      await onRebuild();
    } catch (error) {
      toast.error(t("indexDatabase.rebuildFailed", { reason: errorText(error) }));
    } finally {
      setRebuilding(false);
    }
  };
  return { rebuilding, rebuild };
}
