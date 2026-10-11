import i18n from "@plainva/ui/i18n";
import { activeLeaveGuard, confirmLeave } from "./leaveGuard";
import { mConfirm } from "./mobileDialogs";

/** The question as the person sees it; `keepArmed` is `confirmLeave`'s. */
function ask(keepArmed: boolean): Promise<boolean> {
  return confirmLeave(
    (message) =>
      mConfirm({
        title: i18n.t("mobile.leaveTitle", { defaultValue: "Eingaben verwerfen?" }),
        message,
        danger: true,
        confirmLabel: i18n.t("mobile.leaveDiscard", { defaultValue: "Verwerfen" }),
      }),
    keepArmed,
  );
}

/**
 * The question every route that leaves a surface asks first.
 *
 * It lives outside the shell so the Android back listener — which registers
 * once and would otherwise capture a stale closure — reaches the same, always
 * current decision as the bar tap and the back arrow. Without an armed guard it
 * resolves immediately, so ordinary navigation is unchanged.
 */
export function askBeforeLeaving(): Promise<boolean> {
  return ask(false);
}

/**
 * Runs a step that takes the surface on top off the screen and is not that
 * surface's own doing (finding 2026-10-09).
 *
 * Only the screen on top is rendered. Whatever is put over it takes its state
 * in the same moment, so "leaving" is not only the back arrow: it is every step
 * that changes what is on top. The bar tap, the back arrow and Android back
 * asked; everything else that can start such a step while a surface holds
 * unsaved input did not — the share inbox drawn over it ("Choose vault",
 * "Unlock", the note it just filed), the settings in a tablet's rail, the areas
 * sheet, the navigator column beside it, a notice's button, a launcher
 * shortcut or a tapped reminder. A message being written went without a word,
 * and with "Choose vault" the vault after it.
 *
 * They all come through here now. Without an armed guard the step runs in the
 * same tick, so nothing changes for a surface with nothing to lose; with one,
 * the question comes first and "cancel" means the step does not happen.
 *
 * "Discard" does not disarm the guard here, unlike on the way back. Several of
 * these steps only MAY leave: a new note asks its template's questions first,
 * a new database its name, and both can be cancelled — the surface is still
 * there then, with its input, and has to be asked about again. The surface
 * disarms the guard itself when it really goes.
 *
 * NOT for the surface's own steps: `push` and `replace` in navActions move a
 * surface forward by its own decision (a wizard to its next page), and `done`
 * is its exit once the work is finished. Those must not ask about work the
 * surface itself is handing on.
 */
export function leaveThen(run: () => void): void {
  if (!activeLeaveGuard()) {
    run();
    return;
  }
  void ask(true).then((ok) => {
    if (ok) run();
  });
}
