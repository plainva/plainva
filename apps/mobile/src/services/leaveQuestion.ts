import i18n from "@plainva/ui/i18n";
import { confirmLeave } from "./leaveGuard";
import { mConfirm } from "./mobileDialogs";

/**
 * The question every route that leaves a surface asks first.
 *
 * It lives outside the shell so the Android back listener — which registers
 * once and would otherwise capture a stale closure — reaches the same, always
 * current decision as the bar tap and the back arrow. Without an armed guard it
 * resolves immediately, so ordinary navigation is unchanged.
 */
export function askBeforeLeaving(): Promise<boolean> {
  return confirmLeave((message) =>
    mConfirm({
      title: i18n.t("mobile.leaveTitle", { defaultValue: "Eingaben verwerfen?" }),
      message,
      danger: true,
      confirmLabel: i18n.t("mobile.leaveDiscard", { defaultValue: "Verwerfen" }),
    }),
  );
}
