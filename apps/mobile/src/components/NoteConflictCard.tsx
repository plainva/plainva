import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button } from "@plainva/ui";
import { clearConflict, type NoteConflict } from "../services/conflictState";
import type { MobileVault } from "../services/vaultService";

/**
 * The card a note shows while a conflict copy of it waits (S5): a conflict is
 * an END STATE, so it stays on screen until the user acts on it. It used to be
 * a toast — one per retry round, each round writing another `.CONFLICT` file
 * that no surface pointed at. The two ways out are the two questions anyone
 * has here: where is my text, and what is different.
 *
 * One definition for the editor and for a note that shows as no text (finding
 * 2026-10-11): there, the card is the one way to the text the editor held
 * when the file turned into something else, kept beside it.
 *
 * A conflict outlives the app (P1, Build-91 feedback): the copy may have been
 * deleted from the file list in the meantime, and a card pointing at nothing
 * would lie — it goes when its copy is gone.
 */
export function NoteConflictCard({ conflict, path, vault, onOpenCopy, onShowDiff }: {
  conflict: NoteConflict;
  path: string;
  vault: MobileVault;
  onOpenCopy: () => void;
  onShowDiff: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    let stale = false;
    vault.files
      .exists(conflict.copyPath)
      .then((ok) => {
        if (!stale && !ok) clearConflict(path);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [conflict, path, vault]);
  return (
    <Banner
      actions={
        <>
          <Button onClick={onOpenCopy} size="sm" variant="ghost">
            {t("mobile.conflictOpenCopy")}
          </Button>
          <Button onClick={onShowDiff} size="sm" variant="ghost">
            {t("mobile.conflictShowDiff")}
          </Button>
        </>
      }
      kind="warning"
      rounded
    >
      <b>{t("mobile.conflictTitle")}</b>
      <br />
      {t(conflict.working ? "conflict.workingCopy" : "mobile.conflictBody")}
      {conflict.foreignCopySnapshot && <><br />{t("conflict.workingCopyChanged")}</>}
      <br />
      <code>{conflict.copyPath}</code>
    </Banner>
  );
}
