import React from "react";
import { useTranslation } from "react-i18next";
import {
  APP_LANGUAGES,
  Button,
  SettingCard,
  SettingCardNote,
  SettingRow,
  SettingsPageHead,
  settingsArea,
} from "@plainva/ui";
import { ThemePickerCards } from "../ThemePickerCards";
import { CustomThemeEditor } from "./CustomThemeEditor";
import { CustomThemeSync, type CustomThemeSyncProps } from "@plainva/ui";
import { CUSTOM_THEME_ID, FONT_SLOT_FAMILIES, FontField, fontKindsForSlot, Switch, type CustomThemeDesign } from "@plainva/ui";
import { AutostartRow, BackgroundSettings } from "./BackgroundSettings";
import { QuickCaptureSettings } from "./QuickCaptureSettings";
import { WindowRestoreRow } from "./WindowSettings";
import { LinkStyleSettings } from "./LinkStyleSettings";
import { StoredCredentialsCard } from "./StoredCredentialsCard";
import { Select } from "../Select";
import { getThemeDef, isModePinned, type ThemePref } from "../../services/theme";
import { pinnedModeHintKey } from "@plainva/ui";
import type { Density } from "../../services/density";
import type { WeekStartSetting } from "@plainva/ui";
import { MIN_CONTENT_FONT_SIZE, MAX_CONTENT_FONT_SIZE, type AppFontSettings, type ContentFontFamily, type FontChoice, type FontSlot } from "../../services/appFonts";
import { DEFAULT_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM, UI_ZOOM_STEP } from "../../services/uiZoom";
import type { EditorViewMode } from "../../services/viewModeDefault";
import type { PerfStat } from "../../services/perfMetrics";

/**
 * The APP-world settings pages (redesign 2026-07-18, P2; Updates became a
 * group of About & diagnostics, settings plan 2026-10-29, E10). All state and
 * persistence stays in SettingsModal — these components only render the
 * quiet-cards layout for it (page head + named group cards).
 */

/** Shared page-head helper: pulls title/desc from the shared area catalog. */
export const AreaHead: React.FC<{ areaId: string; children?: React.ReactNode }> = ({ areaId, children }) => {
  const { t } = useTranslation();
  const area = settingsArea(areaId);
  if (!area) return null;
  return <SettingsPageHead title={t(area.labelKey)} desc={t(area.descKey)}>{children}</SettingsPageHead>;
};

const FONT_PRESET_LABEL: Record<Exclude<ContentFontFamily, "theme" | "custom">, [string, string]> = {
  serif: ["settings.fontSerif", "Serif"],
  sans: ["settings.fontSans", "Sans-Serif"],
  mono: ["settings.fontMono", "Monospace"],
};

/** One font slot: a family choice, and the catalogue field once it is "custom".
 * The code slot offers monospace only — presets and catalogue alike (P2). */
const FontSlotRow: React.FC<{ slot: FontSlot; label: string; info: string; choice: FontChoice; onChange: (choice: FontChoice) => void }> = ({ slot, label, info, choice, onChange }) => {
  const { t } = useTranslation();
  // The content slot keeps the test ids the E2E smoke has used since A3.
  const idBase = slot === "content" ? "content-font" : `${slot}-font`;
  return (
    <SettingRow label={label} info={info}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Select
          ariaLabel={label}
          value={choice.family}
          data-testid={`${idBase}-family`}
          onChange={(v) => onChange({ family: v as ContentFontFamily, customName: choice.customName })}
          options={[
            { value: "theme", label: t("settings.fontTheme", { defaultValue: "Theme-Standard" }) },
            ...FONT_SLOT_FAMILIES[slot].map((family) => ({ value: family, label: t(FONT_PRESET_LABEL[family][0], { defaultValue: FONT_PRESET_LABEL[family][1] }) })),
            { value: "custom", label: t("settings.fontCustom", { defaultValue: "Benutzerdefiniert…" }) },
          ]}
        />
        {choice.family === "custom" && (
          /* One field that shows the chosen family; the curated list (a
             preview per row, a verdict on whether the device has the font)
             and the free name open on click (second look 2026-09-04, A3). */
          <FontField
            value={choice.customName}
            onChange={(css) => onChange({ family: "custom", customName: css })}
            defaultLabel={t("settings.fontFieldEmpty")}
            ariaLabel={label}
            kinds={fontKindsForSlot(slot)}
            data-testid={`${idBase}-custom`}
          />
        )}
      </div>
    </SettingRow>
  );
};

export interface AppearancePageProps {
  themeName: string;
  onThemeName: (name: string) => void;
  customTheme: CustomThemeDesign;
  /** The pencil on the "Mein Design" card: opens its own settings page (A2). */
  onEditCustomTheme: () => void;
  themePref: ThemePref;
  onThemePref: (pref: ThemePref) => void;
  appLanguage: string;
  onLanguage: (lang: string) => void;
  weekStart: WeekStartSetting;
  onWeekStart: (v: WeekStartSetting) => void;
  density: Density;
  onDensity: (d: Density) => void;
  /** "Colour tags" (finding 2026-09-19): device-local, off by default. */
  tagColors: boolean;
  onTagColors: (on: boolean) => void;
  uiZoom: number;
  onUiZoom: (z: number) => void;
  /** The three font slots + content size (issue #82). */
  fonts: AppFontSettings;
  onFonts: (next: AppFontSettings) => void;
}

export const AppearancePage: React.FC<AppearancePageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="appearance" />
      <SettingCard label={t("settings.groupDesign", { defaultValue: "Design" })}>
        <SettingRow label={t("settings.themeName", { defaultValue: "Theme" })} wide>
          <ThemePickerCards
            value={p.themeName}
            onChange={p.onThemeName}
            customTheme={p.customTheme}
            onEdit={() => { if (p.themeName !== CUSTOM_THEME_ID) p.onThemeName(CUSTOM_THEME_ID); p.onEditCustomTheme(); }}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.themeMode", { defaultValue: "Modus" })}
          desc={pinnedModeHintKey(p.themeName) ? t(pinnedModeHintKey(p.themeName)!) : undefined}
        >
          <div style={{ width: "100%" }}>
            {isModePinned(p.themeName) ? (
              <Select
                ariaLabel={t("settings.themeMode", { defaultValue: "Modus" })}
                value={getThemeDef(p.themeName)?.modes[0] ?? "dark"}
                onChange={() => {}}
                disabled
                options={[
                  { value: "light", label: t("settings.themeLight") },
                  { value: "dark", label: t("settings.themeDark") },
                ]}
              />
            ) : (
              <Select
                ariaLabel={t("settings.themeMode", { defaultValue: "Modus" })}
                value={p.themePref}
                onChange={(v) => p.onThemePref(v as ThemePref)}
                options={[
                  { value: "system", label: t("settings.themeSystem") },
                  { value: "light", label: t("settings.themeLight") },
                  { value: "dark", label: t("settings.themeDark") },
                ]}
              />
            )}
          </div>
        </SettingRow>
      </SettingCard>

      {/* One card for the three font slots (issue #82, plan 2026-09-06 P2/E2):
          interface, content, code — the content font used to live on the
          Editor page and the interface font inside "My design"; the code font
          could not be set at all. What each slot covers is behind its ⓘ, and
          the card's ⓘ says why fonts are a matter of the device (settings plan
          2026-10-29, appendix 2.1). */}
      <SettingCard label={t("settings.groupFonts")} info={t("settings.fontsDeviceHint")} testId="appearance-fonts">
        <FontSlotRow slot="ui" label={t("settings.fontUi")} info={t("settings.fontUiDesc")} choice={p.fonts.fonts.ui} onChange={(c) => p.onFonts({ ...p.fonts, fonts: { ...p.fonts.fonts, ui: c } })} />
        <FontSlotRow slot="content" label={t("settings.fontContent")} info={t("settings.fontContentDesc")} choice={p.fonts.fonts.content} onChange={(c) => p.onFonts({ ...p.fonts, fonts: { ...p.fonts.fonts, content: c } })} />
        <FontSlotRow slot="code" label={t("settings.fontCode")} info={t("settings.fontCodeDesc")} choice={p.fonts.fonts.code} onChange={(c) => p.onFonts({ ...p.fonts, fonts: { ...p.fonts.fonts, code: c } })} />
        <SettingRow
          label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
          info={t("settings.contentFontSizeDesc", { defaultValue: "Schriftgröße von Editor und Leseansicht; die Oberfläche bleibt unverändert." })}
        >
          <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <input
              type="range"
              min={MIN_CONTENT_FONT_SIZE}
              max={MAX_CONTENT_FONT_SIZE}
              step={1}
              value={p.fonts.size}
              aria-label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
              onChange={(e) => p.onFonts({ ...p.fonts, size: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: "44px", textAlign: "right", fontSize: "var(--text-md)", color: "var(--text-muted)" }}>
              {p.fonts.size} px
            </span>
          </div>
        </SettingRow>
      </SettingCard>

      {/* "Sprache & Darstellung" held eight unlike rows; it is three cards now,
          one subject each (settings plan 2026-10-29, appendix 2.1 B1). The
          place stamp went to Editor & notes › Journal (B2). */}
      <SettingCard label={t("settings.groupLanguageRegion")} testId="appearance-language-region">
        <SettingRow label={t("settings.language")}>
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.language")}
              value={p.appLanguage}
              onChange={p.onLanguage}
              options={APP_LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName }))}
            />
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.weekStart", { defaultValue: "Wochenbeginn" })}
          info={t("settings.weekStartDesc", { defaultValue: "Erster Wochentag in allen Kalender-Ansichten." })}
        >
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.weekStart", { defaultValue: "Wochenbeginn" })}
              value={p.weekStart}
              onChange={(v) => p.onWeekStart(v as WeekStartSetting)}
              options={[
                { value: "monday", label: t("settings.weekStartMonday", { defaultValue: "Montag" }) },
                { value: "saturday", label: t("settings.weekStartSaturday", { defaultValue: "Samstag" }) },
                { value: "sunday", label: t("settings.weekStartSunday", { defaultValue: "Sonntag" }) },
              ]}
            />
          </div>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupDisplay")} testId="appearance-display">
        <SettingRow
          label={t("settings.density", { defaultValue: "Kompaktheitsgrad" })}
          info={t("settings.densityDesc", { defaultValue: "Kompakt verdichtet Dateibaum, Listen, Menüs und Tabellen; der Notiz-Inhalt bleibt unverändert." })}
        >
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.density", { defaultValue: "Kompaktheitsgrad" })}
              value={p.density}
              onChange={(v) => p.onDensity(v as Density)}
              options={[
                { value: "comfortable", label: t("settings.densityComfortable", { defaultValue: "Standard" }) },
                { value: "compact", label: t("settings.densityCompact", { defaultValue: "Kompakt" }) },
              ]}
            />
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.uiZoom", { defaultValue: "Oberflächen-Zoom" })}
          info={t("settings.uiZoomDesc", { defaultValue: "Skaliert die gesamte Oberfläche. Auch per Strg/Cmd + Plus/Minus; 0 setzt zurück." })}
        >
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.uiZoom", { defaultValue: "Oberflächen-Zoom" })}
              value={String(p.uiZoom)}
              onChange={(v) => p.onUiZoom(Number(v))}
              options={Array.from(
                { length: (MAX_UI_ZOOM - MIN_UI_ZOOM) / UI_ZOOM_STEP + 1 },
                (_, i) => MIN_UI_ZOOM + i * UI_ZOOM_STEP
              ).map((z) => ({ value: String(z), label: `${z} %${z === DEFAULT_UI_ZOOM ? ` (${t("settings.uiZoomDefault", { defaultValue: "Standard" })})` : ""}` }))}
            />
          </div>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupLinksTags")} testId="appearance-links-tags">
        <LinkStyleSettings />
        <SettingRow label={t("settings.tagColors")} info={t("settings.tagColorsDesc")}>
          <Switch checked={p.tagColors} label={t("settings.tagColors")} onChange={p.onTagColors} />
        </SettingRow>
      </SettingCard>
    </div>
  );
};

export interface EditorPageProps {
  defaultViewMode: EditorViewMode;
  onDefaultViewMode: (m: EditorViewMode) => void;
  /** Ask before creating a note from an unresolved wiki link (default off). */
  askBeforeCreateLink: boolean;
  onAskBeforeCreateLink: (value: boolean) => void;
  /** The device's spell-checking switch (plan Befunde 2026-10-06, E3): device-local, off by default. */
  spellcheck: boolean;
  onSpellcheck: (on: boolean) => void;
  /** Open a new note in a tab of its own (issue 135): device-local, off by default. */
  newNotesInNewTab: boolean;
  onNewNotesInNewTab: (on: boolean) => void;
  /** May the journal capture offer the place button (plan Journal-Erweiterungen, E6)? Device-local, off by default. */
  placeStamp: boolean;
  onPlaceStamp: (v: boolean) => void;
}

/**
 * wry never switches WebKitGTK's spell checker on, and it is off by default
 * there, so on Linux the switch changes the attribute and nothing checks. The
 * page says so instead of offering a control that silently does nothing.
 */
const IS_LINUX_DESKTOP = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent || "") && !/Android/.test(navigator.userAgent || "");

export const EditorPage: React.FC<EditorPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="editor" />
      <SettingCard label={t("settings.groupView", { defaultValue: "Ansicht" })}>
        <SettingRow
          label={t("settings.defaultViewMode", { defaultValue: "Standard-Ansicht" })}
          info={t("settings.defaultViewModeDesc", { defaultValue: "Notizen öffnen in dieser Ansicht; ein manueller Wechsel gilt je Datei für die laufende Sitzung." })}
        >
          <div style={{ width: "100%" }}>
            <Select
              ariaLabel={t("settings.defaultViewMode", { defaultValue: "Standard-Ansicht" })}
              value={p.defaultViewMode}
              onChange={(v) => p.onDefaultViewMode(v as EditorViewMode)}
              options={[
                { value: "read", label: t("editor.readMode") },
                { value: "live", label: t("editor.livePreview") },
                { value: "source", label: t("editor.sourceMode") },
              ]}
            />
          </div>
        </SettingRow>
        <SettingRow label={t("settings.newNotesInNewTab")} info={t("settings.newNotesInNewTabDesc")}>
          <Switch checked={p.newNotesInNewTab} label={t("settings.newNotesInNewTab")} onChange={p.onNewNotesInNewTab} />
        </SettingRow>
      </SettingCard>

      {/* "Writing" and "Links" were two cards of one row each; one card now
          (settings plan 2026-10-29, appendix 2.3 B1). What spell checking
          covers and what the right-click does are behind its ⓘ; that the
          switch does nothing on Linux stays visible. */}
      <SettingCard label={t("settings.groupWriting")} testId="editor-writing">
        <SettingRow
          label={t("settings.spellcheck")}
          info={`${t("settings.spellcheckDesc")}\n\n${t("settings.spellcheckMenuDesc")}`}
          desc={IS_LINUX_DESKTOP ? t("settings.spellcheckLinux") : undefined}
        >
          <Switch checked={p.spellcheck} label={t("settings.spellcheck")} onChange={p.onSpellcheck} />
        </SettingRow>
        <SettingRow
          label={t("settings.askBeforeCreateLink", { defaultValue: "Vor dem Anlegen leerer Links fragen" })}
          info={t("settings.askBeforeCreateLinkDesc", { defaultValue: "Ein Klick auf einen Link zu einer noch nicht existierenden Notiz legt sie normalerweise sofort an. Mit dieser Option wird vorher gefragt." })}
        >
          <Switch
            testId="askBeforeCreateLink"
            label={t("settings.askBeforeCreateLink", { defaultValue: "Vor dem Anlegen leerer Links fragen" })}
            checked={p.askBeforeCreateLink}
            onChange={p.onAskBeforeCreateLink}
          />
        </SettingRow>
      </SettingCard>

      {/* The journal's device settings (appendix 2.3 B2): the place stamp came
          from Appearance — it is about capturing, not about how Plainva looks.
          The global quick capture stays in Startup & behavior, beside running
          in the background it depends on (B3). */}
      <SettingCard label={t("settings.editorGroupJournal")} testId="editor-journal">
        <SettingRow label={t("settings.placeStamp")} info={t("settings.placeStampDesc")}>
          <Switch checked={p.placeStamp} label={t("settings.placeStamp")} onChange={p.onPlaceStamp} testId="place-stamp-switch" />
        </SettingRow>
      </SettingCard>
    </div>
  );
};

export interface BehaviorPageProps {
  autoOpenLastVault: boolean;
  onAutoOpenLastVault: (v: boolean) => void;
  showCompatibilityWarning: boolean;
  onShowCompatibilityWarning: (v: boolean) => void;
  onShowWhatsNew?: () => void;
  /** Arms the first-run welcome for the next start without an open vault. */
  onRequestWelcome?: () => void | Promise<void>;
}

export const BehaviorPage: React.FC<BehaviorPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="behavior" />
      {/* "Startup" and "Windows" were cards of one row each; starting with the
          system is a start behaviour too (settings plan 2026-10-29, appendix
          2.4 B1). Background, quick capture and hints follow (B2-B4). */}
      <SettingCard label={t("settings.groupStart", { defaultValue: "Start" })} testId="behavior-start">
        <AutostartRow />
        <SettingRow label={t("splash.autoOpenLastVault")} info={t("settings.autoOpenLastVaultDesc")}>
          <Switch testId="autoOpenLastVault" label={t("splash.autoOpenLastVault")} checked={p.autoOpenLastVault} onChange={p.onAutoOpenLastVault} />
        </SettingRow>
        <WindowRestoreRow />
      </SettingCard>
      <BackgroundSettings />
      <QuickCaptureSettings />
      <SettingCard label={t("settings.groupHints", { defaultValue: "Hinweise" })}>
        <SettingRow label={t("settings.showCompatWarning")}>
          <Switch testId="showCompat" label={t("settings.showCompatWarning")} checked={p.showCompatibilityWarning} onChange={p.onShowCompatibilityWarning} />
        </SettingRow>
        <SettingRow label={t("settings.showWhatsNew", "Neuerungen erneut anzeigen")}>
          <Button variant="secondary" size="sm" onClick={() => {
            p.onShowWhatsNew?.();
            window.dispatchEvent(new CustomEvent("plainva-show-whats-new"));
          }}>
            {t("common.show", "Anzeigen")}
          </Button>
        </SettingRow>
        {/* The welcome cannot open on top of an open vault — it belongs to a
            start without one. So this arms it for the next such start rather
            than promising something it cannot do right now; the description
            says as much. */}
        <SettingRow label={t("settings.showWelcome")} desc={t("settings.showWelcomeDesc")}>
          <Button variant="secondary" size="sm" onClick={() => void p.onRequestWelcome?.()}>
            {t("settings.showWelcomeAction")}
          </Button>
        </SettingRow>
      </SettingCard>
    </div>
  );
};

/** The update controls: a group of About & diagnostics on the desktop (E10). */
export interface UpdatesGroupProps {
  autoUpdateCheckEnabled: boolean;
  onAutoUpdateCheck: (v: boolean) => void;
  updateStatus: string;
  updateAvailable: boolean;
  isUpdating: boolean;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}

/**
 * "Updates" was a page of two rows; it is the second group of About &
 * diagnostics now — the version and the way to the next one belong together
 * (settings plan 2026-10-29, appendix 2.5 B1). The phone has no such group:
 * Google Play and TestFlight update the app (parity catalog in-app-updates).
 */
const UpdatesGroup: React.FC<UpdatesGroupProps> = (p) => {
  const { t } = useTranslation();
  return (
    <SettingCard label={t("settings.updates", "Updates")} testId="about-updates">
      <SettingRow label={t("settings.autoUpdateCheck")} info={t("settings.autoUpdateCheckDesc")}>
        <Switch testId="autoUpdateCheck" label={t("settings.autoUpdateCheck")} checked={p.autoUpdateCheckEnabled} onChange={p.onAutoUpdateCheck} />
      </SettingRow>
      <SettingRow label={t("settings.groupUpdate", { defaultValue: "Aktualisierung" })} desc={p.updateStatus || undefined}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
          <button
            onClick={p.onCheckUpdates}
            disabled={p.isUpdating}
            className="pv-btn pv-btn--secondary" style={{ cursor: p.isUpdating ? "not-allowed" : "pointer" }}
          >
            {t("settings.checkUpdates", "Nach Updates suchen")}
          </button>
          {p.updateAvailable && !p.isUpdating && (
            <button onClick={p.onInstallUpdate} className="pv-btn pv-btn--primary">
              {t("settings.installUpdate", "Jetzt installieren & Neustarten")}
            </button>
          )}
        </div>
      </SettingRow>
    </SettingCard>
  );
};

export interface AboutPageProps {
  aboutLine: string;
  keychainStatus: string;
  perfStats: PerfStat[] | null;
  onRefreshPerfStats: () => void;
  onExportPerfMetrics: () => void;
  onExportDiagnostics: () => void;
  onReportIssue: () => void;
  /** The update controls, shown as the page's second group (E10). */
  updates: UpdatesGroupProps;
}

export const AboutPage: React.FC<AboutPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="about" />
      <SettingCard label={t("settings.groupProgram", { defaultValue: "Programm" })}>
        <SettingRow label={t("settings.aboutVersions")} desc={p.aboutLine}>
          <Button variant="secondary" size="sm" onClick={p.onExportDiagnostics}>
            {t("settings.exportDiagnostics")}
          </Button>
        </SettingRow>
      </SettingCard>

      <UpdatesGroup {...p.updates} />

      {/* Stored access and the OS keychain (settings plan 2026-10-29, move 15, B1):
          app-wide, so here, beside each other. */}
      <StoredCredentialsCard keychainStatus={p.keychainStatus} />

      <SettingCard label={t("settings.groupDiagnostics", { defaultValue: "Diagnose" })}>
        <SettingRow label={t("settings.perfMetrics", { defaultValue: "Performance-Messwerte" })} info={t("settings.perfMetricsDesc", { defaultValue: "Lokale Messpunkte dieser Sitzung (Median/p95 in ms) — verlassen das Gerät nie." })}>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="secondary" size="sm" onClick={p.onRefreshPerfStats}>
              {t("settings.perfMetricsRefresh", { defaultValue: "Anzeigen/Aktualisieren" })}
            </Button>
            <Button variant="secondary" size="sm" onClick={p.onExportPerfMetrics}>
              {t("settings.perfMetricsExport", { defaultValue: "Als JSON exportieren…" })}
            </Button>
          </div>
        </SettingRow>
        {p.perfStats && p.perfStats.length > 0 && (
          <SettingCardNote>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "2px 8px 2px 0" }}>{t("settings.perfMetricPoint", { defaultValue: "Messpunkt" })}</th>
                  <th style={{ textAlign: "right", padding: "2px 8px" }}>n</th>
                  <th style={{ textAlign: "right", padding: "2px 8px" }}>Median</th>
                  <th style={{ textAlign: "right", padding: "2px 8px" }}>p95</th>
                </tr>
              </thead>
              <tbody>
                {p.perfStats.map((s) => (
                  <tr key={s.name}>
                    <td style={{ padding: "2px 8px 2px 0" }}>{s.name}</td>
                    <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.count}</td>
                    <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.medianMs} ms</td>
                    <td style={{ textAlign: "right", padding: "2px 8px" }}>{s.p95Ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingCardNote>
        )}
        {p.perfStats && p.perfStats.length === 0 && (
          <SettingCardNote>{t("settings.perfMetricsEmpty", { defaultValue: "Noch keine Messwerte in dieser Sitzung." })}</SettingCardNote>
        )}
        <SettingRow label={t("settings.reportIssue")} desc={t("settings.reportIssueDesc")}>
          <Button variant="secondary" size="sm" onClick={p.onReportIssue}>
            {t("settings.reportIssueAction")}
          </Button>
        </SettingRow>
      </SettingCard>
    </div>
  );
};

/**
 * "Mein Design" as its own page (second look 2026-09-04, A2): reached from
 * the pencil on the theme card, with a way back to Appearance. The editor
 * had no room under the gallery — and its height reflowed the gallery.
 */
export interface CustomThemePageProps {
  spec: CustomThemeDesign;
  onChange: (spec: CustomThemeDesign) => void | Promise<void>;
  onBack: () => void;
  designSync: CustomThemeSyncProps;
  /** The page is the one shown (and its stored design has loaded): only then
   * does the app wear the mood being edited (E22). */
  active: boolean;
}

export const CustomThemePage: React.FC<CustomThemePageProps> = ({ spec, onChange, onBack, designSync, active }) => {
  const { t } = useTranslation();
  return (
    <div data-testid="custom-theme-page">
      <div style={{ marginBottom: "var(--space-2)" }}>
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="custom-theme-back">
          ‹ {t("settings.sectionAppearance")}
        </Button>
      </div>
      <SettingsPageHead title={t("themes.names.custom")} desc={t("settings.customThemePageDesc")} info={t("settings.customThemePairHint")} />
      <CustomThemeEditor spec={spec} onChange={onChange} active={active}>
        <CustomThemeSync {...designSync} />
      </CustomThemeEditor>
    </div>
  );
};
