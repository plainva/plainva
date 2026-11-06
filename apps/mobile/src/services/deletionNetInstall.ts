import { registerDeletionNetQuestion } from "@plainva/ui";
import { mConfirm } from "./mobileDialogs";

/**
 * Registers the phone's sheet for "Delete without a backup?" (D1 of the
 * data-safety plan of 2026-11-06): the words are the shared ones
 * (`deletionNetQuestion`), "Cancel" the quiet safe branch and "Delete anyway"
 * the danger button, as in the desktop's dialog.
 */
export function installDeletionNetQuestion(): void {
  registerDeletionNetQuestion((question) => mConfirm({ ...question, danger: true }));
}
