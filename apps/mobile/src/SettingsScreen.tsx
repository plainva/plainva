import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronLeft } from "lucide-react";
import { APP_LANGUAGES, SelectField, TextInput } from "@plainva/ui";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
  type ThemeMode,
} from "./services/mobileSettings";
import { MAX_TAB_SLOTS, sanitizeTabSlots, TAB_POOL, type TabScreenId } from "./navigation";

/**
 * Mobile settings (P1): language, theme mode, default note view and the
 * daily-notes folder. Values persist through the platform settings store
 * and apply immediately (desktop hybrid-save model: no save button).
 * R2.2 adds the tab-bar layout: up to four pool screens, ▲▼ reorder.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());

  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };

  const slots = sanitizeTabSlots(settings.tabSlots);
  const setSlots = (next: TabScreenId[]) => update({ tabSlots: next });
  const toggleSlot = (id: TabScreenId) => {
    if (slots.includes(id)) {
      if (slots.length > 1) setSlots(slots.filter((s) => s !== id));
    } else if (slots.length < MAX_TAB_SLOTS) {
      setSlots([...slots, id]);
    }
  };
  const moveSlot = (id: TabScreenId, delta: -1 | 1) => {
    const idx = slots.indexOf(id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= slots.length) return;
    const next = [...slots];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    setSlots(next);
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

      <p className="m-sectionlabel">{t("mobile.settingTabs")}</p>
      <p className="m-hint">{t("mobile.settingTabsHint", { max: MAX_TAB_SLOTS })}</p>
      {/* Selected screens first (in bar order, with reorder arrows), then the rest. */}
      {[...slots.map((id) => TAB_POOL.find((p) => p.id === id)!), ...TAB_POOL.filter((p) => !slots.includes(p.id))].map(
        (def) => {
          const selected = slots.includes(def.id);
          const idx = slots.indexOf(def.id);
          const Icon = def.icon;
          return (
            <div className="m-row m-row--split" key={def.id}>
              <button
                aria-pressed={selected}
                className="m-row-main"
                onClick={() => toggleSlot(def.id)}
              >
                <Icon className={selected ? "m-accent" : "m-chevron"} size={18} />
                <span>{t(def.labelKey)}</span>
                <span className={`m-slotmark${selected ? " is-on" : ""}`} />
              </button>
              {selected && (
                <>
                  <button
                    aria-label={t("block.moveUp")}
                    className="m-iconbtn"
                    disabled={idx === 0}
                    onClick={() => moveSlot(def.id, -1)}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    aria-label={t("block.moveDown")}
                    className="m-iconbtn"
                    disabled={idx === slots.length - 1}
                    onClick={() => moveSlot(def.id, 1)}
                  >
                    <ArrowDown size={18} />
                  </button>
                </>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}
