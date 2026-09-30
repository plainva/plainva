import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { Banner } from "./ui";
import type { CustomThemeMode } from "../lib/customTheme";
import type { AppliedTheme, ThemePref } from "../lib/themeRegistry";

/**
 * The sentence over "My theme" on both shells (plan Befunde 2026-09-24, E22):
 * the whole app shows the mood being edited while the page is open. When
 * leaving will change the look, it also says what applies then — the Mode
 * setting, or the pinned mood of a design with only one — in the words the
 * shell's own mode control uses (`mobile`: the phone's segments).
 */
export function CustomThemePreviewBanner({ mood, stored, mobile }: { mood: CustomThemeMode; stored: AppliedTheme; mobile?: boolean }) {
  const { t } = useTranslation();
  const ns = mobile ? "mobile" : "settings";
  const modeLabel = (pref: ThemePref) => t(`${ns}.${pref === "system" ? "themeSystem" : pref === "dark" ? "themeDark" : "themeLight"}`);
  const now = t(mood === "dark" ? "settings.customThemePreviewDark" : "settings.customThemePreviewLight");
  const after = stored.mode !== mood ? t("settings.customThemePreviewAfter", { mode: modeLabel(stored.pinned ? stored.mode : stored.pref) }) : "";
  return (
    <Banner kind="info" rounded icon={Eye}>
      <span data-testid="custom-theme-preview-banner">{after ? `${now} ${after}` : now}</span>
    </Banner>
  );
}
