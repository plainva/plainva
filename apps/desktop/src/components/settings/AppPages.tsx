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
import { Select } from "../Select";
import { getThemeDef, isModePinned, type ThemePref } from "../../services/theme";
import type { Density } from "../../services/density";
import type { WeekStartSetting } from "../../services/weekStart";
import { MIN_CONTENT_FONT_SIZE, MAX_CONTENT_FONT_SIZE, type ContentFontSettings, type ContentFontFamily } from "../../services/contentFont";
import { DEFAULT_UI_ZOOM, MIN_UI_ZOOM, MAX_UI_ZOOM, UI_ZOOM_STEP } from "../../services/uiZoom";
import type { EditorViewMode } from "../../services/viewModeDefault";
import type { PerfStat } from "../../services/perfMetrics";

/**
 * The five APP-world settings pages (redesign 2026-07-18, P2). All state and
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

export interface AppearancePageProps {
  themeName: string;
  onThemeName: (name: string) => void;
  themePref: ThemePref;
  onThemePref: (pref: ThemePref) => void;
  appLanguage: string;
  onLanguage: (lang: string) => void;
  weekStart: WeekStartSetting;
  onWeekStart: (v: WeekStartSetting) => void;
  density: Density;
  onDensity: (d: Density) => void;
  uiZoom: number;
  onUiZoom: (z: number) => void;
}

export const AppearancePage: React.FC<AppearancePageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="appearance" />
      <SettingCard label={t("settings.groupDesign", { defaultValue: "Design" })}>
        <SettingRow label={t("settings.themeName", { defaultValue: "Theme" })} wide>
          <ThemePickerCards value={p.themeName} onChange={p.onThemeName} />
        </SettingRow>
        <SettingRow
          label={t("settings.themeMode", { defaultValue: "Modus" })}
          desc={isModePinned(p.themeName) ? t("titlebar.themePinned", { defaultValue: "Modus vom Theme festgelegt" }) : undefined}
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

      <SettingCard label={t("settings.groupLanguageDisplay", { defaultValue: "Sprache & Darstellung" })}>
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
          desc={t("settings.weekStartDesc", { defaultValue: "Erster Wochentag in allen Kalender-Ansichten." })}
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
        <SettingRow
          label={t("settings.density", { defaultValue: "Kompaktheitsgrad" })}
          desc={t("settings.densityDesc", { defaultValue: "Kompakt verdichtet Dateibaum, Listen, Menüs und Tabellen; der Notiz-Inhalt bleibt unverändert." })}
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
          desc={t("settings.uiZoomDesc", { defaultValue: "Skaliert die gesamte Oberfläche. Auch per Strg/Cmd + Plus/Minus; 0 setzt zurück." })}
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
    </div>
  );
};

export interface EditorPageProps {
  defaultViewMode: EditorViewMode;
  onDefaultViewMode: (m: EditorViewMode) => void;
  contentFont: ContentFontSettings;
  onContentFont: (next: ContentFontSettings) => void;
  /** Ask before creating a note from an unresolved wiki link (default off). */
  askBeforeCreateLink: boolean;
  onAskBeforeCreateLink: (value: boolean) => void;
}

export const EditorPage: React.FC<EditorPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="editor" />
      <SettingCard label={t("settings.groupView", { defaultValue: "Ansicht" })}>
        <SettingRow
          label={t("settings.defaultViewMode", { defaultValue: "Standard-Ansicht" })}
          desc={t("settings.defaultViewModeDesc", { defaultValue: "Notizen öffnen in dieser Ansicht; ein manueller Wechsel gilt je Datei für die laufende Sitzung." })}
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
      </SettingCard>

      <SettingCard label={t("settings.groupContentFont", { defaultValue: "Schrift im Inhalt" })}>
        <SettingRow
          label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
          desc={t("settings.contentFontSizeDesc", { defaultValue: "Schriftgröße von Editor und Leseansicht; die Oberfläche bleibt unverändert." })}
        >
          <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="range"
              min={MIN_CONTENT_FONT_SIZE}
              max={MAX_CONTENT_FONT_SIZE}
              step={1}
              value={p.contentFont.size}
              aria-label={t("settings.contentFontSize", { defaultValue: "Inhalts-Schriftgröße" })}
              onChange={(e) => p.onContentFont({ ...p.contentFont, size: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: "44px", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {p.contentFont.size} px
            </span>
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.contentFontFamily", { defaultValue: "Inhalts-Schriftart" })}
          desc={t("settings.contentFontFamilyDesc", { defaultValue: "Schriftart des Notiz-Inhalts. „Theme-Standard“ folgt dem gewählten Theme." })}
        >
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
            <Select
              ariaLabel={t("settings.contentFontFamily", { defaultValue: "Inhalts-Schriftart" })}
              value={p.contentFont.family}
              onChange={(v) => p.onContentFont({ ...p.contentFont, family: v as ContentFontFamily })}
              options={[
                { value: "theme", label: t("settings.fontTheme", { defaultValue: "Theme-Standard" }) },
                { value: "serif", label: t("settings.fontSerif", { defaultValue: "Serif" }) },
                { value: "sans", label: t("settings.fontSans", { defaultValue: "Sans-Serif" }) },
                { value: "mono", label: t("settings.fontMono", { defaultValue: "Monospace" }) },
                { value: "custom", label: t("settings.fontCustom", { defaultValue: "Benutzerdefiniert…" }) },
              ]}
            />
            {p.contentFont.family === "custom" && (
              <input
                autoComplete="off"
                value={p.contentFont.customName}
                placeholder={t("settings.fontCustomPlaceholder", { defaultValue: "Name einer installierten Schriftart" })}
                onChange={(e) => p.onContentFont({ ...p.contentFont, customName: e.target.value })}
                className="pv-field" style={{ width: "100%" }}
              />
            )}
          </div>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupLinks", { defaultValue: "Links" })}>
        <SettingRow
          label={t("settings.askBeforeCreateLink", { defaultValue: "Vor dem Anlegen leerer Links fragen" })}
          desc={t("settings.askBeforeCreateLinkDesc", { defaultValue: "Ein Klick auf einen Link zu einer noch nicht existierenden Notiz legt sie normalerweise sofort an. Mit dieser Option wird vorher gefragt." })}
        >
          <input
            type="checkbox"
            id="askBeforeCreateLink"
            aria-label={t("settings.askBeforeCreateLink", { defaultValue: "Vor dem Anlegen leerer Links fragen" })}
            checked={p.askBeforeCreateLink}
            onChange={(e) => p.onAskBeforeCreateLink(e.target.checked)}
          />
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
}

export const BehaviorPage: React.FC<BehaviorPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="behavior" />
      <SettingCard label={t("settings.groupStart", { defaultValue: "Start" })}>
        <SettingRow label={t("splash.autoOpenLastVault")} desc={t("settings.autoOpenLastVaultDesc")}>
          <input type="checkbox" id="autoOpenLastVault" aria-label={t("splash.autoOpenLastVault")} checked={p.autoOpenLastVault} onChange={(e) => p.onAutoOpenLastVault(e.target.checked)} />
        </SettingRow>
      </SettingCard>
      <SettingCard label={t("settings.groupHints", { defaultValue: "Hinweise" })}>
        <SettingRow label={t("settings.showCompatWarning")}>
          <input type="checkbox" id="showCompat" aria-label={t("settings.showCompatWarning")} checked={p.showCompatibilityWarning} onChange={(e) => p.onShowCompatibilityWarning(e.target.checked)} />
        </SettingRow>
      </SettingCard>
    </div>
  );
};

export interface UpdatesPageProps {
  autoUpdateCheckEnabled: boolean;
  onAutoUpdateCheck: (v: boolean) => void;
  updateStatus: string;
  updateAvailable: boolean;
  isUpdating: boolean;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}

export const UpdatesPage: React.FC<UpdatesPageProps> = (p) => {
  const { t } = useTranslation();
  return (
    <div>
      <AreaHead areaId="updates" />
      <SettingCard label={t("settings.groupUpdate", { defaultValue: "Aktualisierung" })}>
        <SettingRow label={t("settings.autoUpdateCheck")} desc={t("settings.autoUpdateCheckDesc")}>
          <input type="checkbox" id="autoUpdateCheck" aria-label={t("settings.autoUpdateCheck")} checked={p.autoUpdateCheckEnabled} onChange={(e) => p.onAutoUpdateCheck(e.target.checked)} />
        </SettingRow>
        <SettingRow label={t("settings.updates", "Updates")} desc={p.updateStatus || undefined}>
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
    </div>
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
        <SettingRow label={t("settings.osKeychain")}>
          <strong style={{ color: p.keychainStatus === "native" ? "var(--accent-color)" : "var(--error-text)", fontSize: "0.9rem" }}>
            {p.keychainStatus === "checking" ? t("settings.keychainChecking") : p.keychainStatus === "native" ? t("settings.keychainNative") : t("settings.keychainFallback")}
          </strong>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.groupDiagnostics", { defaultValue: "Diagnose" })}>
        <SettingRow label={t("settings.perfMetrics", { defaultValue: "Performance-Messwerte" })} desc={t("settings.perfMetricsDesc", { defaultValue: "Lokale Messpunkte dieser Sitzung (Median/p95 in ms) — verlassen das Gerät nie." })}>
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
