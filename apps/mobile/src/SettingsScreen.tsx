import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { APP_LANGUAGES, SelectField, TextInput } from "@plainva/ui";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
  type ThemeMode,
} from "./services/mobileSettings";

/**
 * Mobile settings (P1): language, theme mode, default note view and the
 * daily-notes folder. Values persist through the platform settings store
 * and apply immediately (desktop hybrid-save model: no save button).
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());

  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.sectionSettings")}</h1>
      </header>

      <div className="m-sync">
        <label className="m-field">
          <span>{t("mobile.settingLanguage")}</span>
          <SelectField
            onChange={(e) => update({ language: e.target.value })}
            value={settings.language}
          >
            <option value="">{t("mobile.settingLanguageSystem")}</option>
            {APP_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="m-field">
          <span>{t("mobile.settingTheme")}</span>
          <SelectField
            onChange={(e) => update({ themeMode: e.target.value as ThemeMode })}
            value={settings.themeMode}
          >
            <option value="system">{t("mobile.themeSystem")}</option>
            <option value="light">{t("mobile.themeLight")}</option>
            <option value="dark">{t("mobile.themeDark")}</option>
          </SelectField>
        </label>

        <label className="m-field">
          <span>{t("mobile.settingDefaultView")}</span>
          <SelectField
            onChange={(e) => update({ defaultView: e.target.value as DefaultView })}
            value={settings.defaultView}
          >
            <option value="read">{t("mobile.defaultViewRead")}</option>
            <option value="edit">{t("mobile.defaultViewEdit")}</option>
          </SelectField>
        </label>

        <label className="m-field">
          <span>{t("mobile.settingDailyFolder")}</span>
          <TextInput
            onChange={(e) => update({ dailyFolder: e.target.value.trim() || "Daily" })}
            value={settings.dailyFolder}
          />
        </label>
      </div>
    </div>
  );
}
