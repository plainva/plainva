import { reportVisible } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The handler for a setting the person changed that did not reach the store
 * (stability plan R4): the screen shows the new value, and after a restart it
 * would be the old one. Said on screen with the phone's words for the same
 * failure (`mobile.settingSaveFailed`, apps/mobile useSettingsState) and
 * written into the diagnostics under `area`.
 */
export function settingNotSaved(area: string): (error: unknown) => void {
  return (error) => reportVisible(area, error, i18n.t("mobile.settingSaveFailed"));
}
