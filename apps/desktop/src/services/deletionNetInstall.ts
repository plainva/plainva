import { registerDeletionNetQuestion } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { appConfirm } from "./appDialogs";

/**
 * Registers the desktop's dialog for "Delete without a backup?" (D1 of the
 * data-safety plan of 2026-11-06): the words are the shared ones
 * (`deletionNetQuestion`); as a danger dialog it focuses "Cancel", the safe
 * answer, and only "Delete anyway" deletes.
 */
export function installDeletionNetQuestion(): void {
  registerDeletionNetQuestion((question) => appConfirm({ ...question, kind: "danger", cancelLabel: i18n.t("common.cancel") }));
}
