import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FolderSearch } from "lucide-react";
import { APP_LANGUAGES, AVAILABLE_THEMES, TextInput } from "@plainva/ui";
import { FolderPickerSheet } from "./components/FolderPickerSheet";
import { mSelect } from "./services/mobileDialogs";
import {
  getMobileSettings,
  updateMobileSettings,
  type DefaultView,
  type ThemeMode,
} from "./services/mobileSettings";
import type { MobileVault } from "./services/vaultService";
import { MAX_TAB_SLOTS, sanitizeTabSlots, TAB_POOL, type TabScreenId } from "./navigation";

/**
 * Mobile settings (P1): language, theme mode, default note view and the
 * daily-notes folder. Values persist through the platform settings store
 * and apply immediately (desktop hybrid-save model: no save button).
 * R2.2 adds the tab-bar layout: up to four pool screens, ▲▼ reorder.
 * R3.3: choices open M3 selection sheets instead of native <select>s.
 */
export function SettingsScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getMobileSettings());
  // Folder picker target (R3.6): which path setting is being browsed.
  const [pickFor, setPickFor] = useState<"dailyFolder" | "inboxFolder" | "templateFolder" | null>(null);

  const update = (patch: Parameters<typeof updateMobileSettings>[0]) => {
    void updateMobileSettings(patch).then(() => setSettings(getMobileSettings()));
  };

  const themeLabel = (mode: ThemeMode) =>
    t(mode === "light" ? "mobile.themeLight" : mode === "dark" ? "mobile.themeDark" : "mobile.themeSystem");
  const viewLabel = (view: DefaultView) =>
    t(view === "edit" ? "mobile.defaultViewEdit" : "mobile.defaultViewRead");
  const languageLabel = (code: string) =>
    code
      ? (APP_LANGUAGES.find((l) => l.code === code)?.nativeName ?? code)
      : t("mobile.settingLanguageSystem");

  const pickLanguage = () => {
    void mSelect({
      title: t("mobile.settingLanguage"),
      options: [
        { value: "", label: t("mobile.settingLanguageSystem") },
        ...APP_LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName })),
      ],
      value: settings.language,
    }).then((v) => {
      if (v !== null) update({ language: v });
    });
  };

  const pickTheme = () => {
    void mSelect({
      title: t("mobile.settingTheme"),
      options: (["system", "light", "dark"] as ThemeMode[]).map((m) => ({
        value: m,
        label: themeLabel(m),
      })),
      value: settings.themeMode,
    }).then((v) => {
      if (v !== null) update({ themeMode: v as ThemeMode });
    });
  };

  const pickDefaultView = () => {
    void mSelect({
      title: t("mobile.settingDefaultView"),
      options: (["read", "edit"] as DefaultView[]).map((m) => ({ value: m, label: viewLabel(m) })),
      value: settings.defaultView,
    }).then((v) => {
      if (v !== null) update({ defaultView: v as DefaultView });
    });
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

      <SettingRow label={t("mobile.settingLanguage")} onClick={pickLanguage} value={languageLabel(settings.language)} />
      <SettingRow label={t("mobile.settingTheme")} onClick={pickTheme} value={themeLabel(settings.themeMode)} />

      {/* Theme catalog (M3E package D4): the shared registry, minus easter-egg
          entries (their unlock flow arrives with the mobile hailing sheet).
          Swatch colors are registry DATA, not styling literals. */}
      <p className="m-sectionlabel">{t("settings.theme")}</p>
      <div className="m-themegrid">
        {AVAILABLE_THEMES.filter((th) => !th.unlock).map((th) => {
          const mode = th.modes.includes(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light")
            ? (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" as const : "light" as const)
            : th.modes[0];
          const sw = th.swatch[mode]!;
          const active = (settings.themeName || "petrol") === th.id;
          return (
            <button
              className={active ? "m-themecard is-on" : "m-themecard"}
              key={th.id}
              onClick={() => update({ themeName: th.id })}
            >
              <span aria-hidden className="m-themeprev">
                <i style={{ background: sw.bg }} />
                <i style={{ background: sw.surface }} />
                <i style={{ background: sw.accent }} />
              </span>
              <span className="m-themename">{t(`themes.names.${th.id}`, { defaultValue: th.label })}</span>
            </button>
          );
        })}
      </div>

      <SettingRow
        label={t("mobile.settingDefaultView")}
        onClick={pickDefaultView}
        value={viewLabel(settings.defaultView)}
      />

      {/* Configurable capture/daily/template folders (R3.6): free text plus
          a vault-internal folder picker on every field. */}
      <p className="m-sectionlabel">{t("mobile.settingFolders")}</p>
      <div className="m-sync">
        <FolderField
          label={t("mobile.settingDailyFolder")}
          onChange={(v) => update({ dailyFolder: v || "Daily" })}
          onPick={() => setPickFor("dailyFolder")}
          value={settings.dailyFolder}
        />
        <FolderField
          label={t("mobile.settingInboxFolder")}
          onChange={(v) => update({ inboxFolder: v || "Inbox" })}
          onPick={() => setPickFor("inboxFolder")}
          value={settings.inboxFolder}
        />
        <FolderField
          label={t("mobile.settingTemplateFolder")}
          onChange={(v) => update({ templateFolder: v || "Templates" })}
          onPick={() => setPickFor("templateFolder")}
          value={settings.templateFolder}
        />
      </div>

      {pickFor && (
        <FolderPickerSheet
          onClose={() => setPickFor(null)}
          onPick={(path) => {
            if (path) update({ [pickFor]: path });
          }}
          title={t("settings.browseFolders")}
          vault={vault}
        />
      )}

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

/** M3 one-line setting: label left, current value right, opens a sheet. */
function SettingRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button className="m-row" onClick={onClick}>
      <span>{label}</span>
      <span className="m-prop-val">{value}</span>
      <ChevronRight className="m-chevron" size={18} />
    </button>
  );
}

/** Path setting: free-text field plus the vault-internal folder picker. */
function FolderField({
  label,
  value,
  onChange,
  onPick,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
}) {
  return (
    <label className="m-field">
      <span>{label}</span>
      <span className="m-field-row">
        <TextInput onChange={(e) => onChange(e.target.value.trim())} value={value} />
        <button aria-label={label} className="m-iconbtn" onClick={(e) => { e.preventDefault(); onPick(); }} type="button">
          <FolderSearch size={20} />
        </button>
      </span>
    </label>
  );
}
