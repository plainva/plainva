import { useCallback } from "react";
import i18n from "@plainva/ui/i18n";
import { useLeaveGuard } from "./useLeaveGuard";
import { disarmLeaveGuard, isLeaveGuardArmed, armedLeaveGuards } from "../services/leaveGuard";
import { mConfirm } from "../services/mobileDialogs";

/**
 * The close of a sheet that holds what the person typed (finding 2026-10-22,
 * § 3.139 Nr. 3).
 *
 * A sheet goes away by a tap beside it, a drag on its grip, Android back or
 * its own "Cancel" — easily by accident, and with the keyboard open a tap
 * beside the sheet is half the screen. The journal entry, the comment, the
 * event, the cell being edited went without a word. And the sheet counted for
 * nothing when the PROGRAM took the screen (a connect run's next step, a
 * reload): nine screens armed a leave guard, no sheet did.
 *
 * Returns the close to hand to every way out — backdrop, `SheetGrip` (which
 * also gives it to Android back), the cancel button. While `dirty`, the sheet
 * arms its guard, so every step that would take it asks, and the close asks
 * first; "Discard" closes. The sheet's own exit after saving does not come
 * here: it calls the plain `onClose`, like a screen's `done`.
 */
export function useSheetGuard(id: string, dirty: boolean, onClose: () => void, message?: string): () => void {
  useLeaveGuard(id, dirty, message ?? i18n.t("mobile.leaveSheet"));
  return useGuardedClose(id, onClose);
}

/**
 * The close half alone: asks while the guard `id` is armed — armed by this
 * sheet (`useSheetGuard`) or by the form it carries (the IMAP form in the mail
 * accounts' sheet arms its own).
 */
export function useGuardedClose(id: string, onClose: () => void): () => void {
  return useCallback(() => {
    if (!isLeaveGuardArmed(id)) {
      onClose();
      return;
    }
    const guard = armedLeaveGuards().find((g) => g.id === id);
    void mConfirm({
      title: i18n.t("mobile.leaveTitle"),
      message: guard?.message ?? i18n.t("mobile.leaveSheet"),
      danger: true,
      confirmLabel: i18n.t("mobile.leaveDiscard"),
    }).then((discard) => {
      if (!discard) return;
      disarmLeaveGuard(id);
      onClose();
    });
  }, [id, onClose]);
}
