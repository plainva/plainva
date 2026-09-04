import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AVAILABLE_THEMES,
  Banner,
  Button,
  FontField,
  Segmented,
  SettingCard,
  SettingRow,
  SwatchGrid,
  clampCustomTheme,
  customAccentPresets,
  customBackgroundPresets,
  customThemeColors,
  customThemeContrast,
  customThemeFromSwatch,
  defaultCustomTheme,
  firstFontFamily,
  formatRatio,
  hexToHsl,
  CUSTOM_ACCENT_MIN_CONTRAST,
  CUSTOM_BACKGROUND_LIGHTNESS,
  CUSTOM_TEXT_SECONDARY_MIN_CONTRAST,
  type CustomThemeCorrection,
  type CustomThemeMode,
  type CustomThemeRadius,
  type CustomThemeSpec,
} from "@plainva/ui";
import { Select } from "../Select";

/**
 * The user's own theme, "Mein Design" (plan 2026-09-04, P2; second look
 * A2–A4): the few things a person may choose, and the readout of what the
 * choice resolves to. Text colours are shown, never edited; a pale accent is
 * corrected and the correction is said in a sentence. Every change persists
 * at once — there is no "apply", the preview IS the app. Rendered on its own
 * settings page (CustomThemePage), the preview first, then three cards.
 */
export interface CustomThemeEditorProps {
  spec: CustomThemeSpec;
  onChange: (spec: CustomThemeSpec) => void;
}

/** The chrome font the design ships, by its first family name ("Inter"). */
function designFontName(): string {
  if (typeof document === "undefined") return "";
  return firstFontFamily(getComputedStyle(document.documentElement).getPropertyValue("--font-ui"));
}

export const CustomThemeEditor: React.FC<CustomThemeEditorProps> = ({ spec, onChange }) => {
  const { t } = useTranslation();
  const [lastCorrection, setLastCorrection] = useState<CustomThemeCorrection | null>(null);
  const colors = useMemo(() => customThemeColors(spec), [spec]);
  const ratios = useMemo(() => customThemeContrast(spec), [spec]);
  const designFont = useMemo(() => designFontName(), []);
  const [lo, hi] = CUSTOM_BACKGROUND_LIGHTNESS[spec.mode];

  const set = (patch: Partial<CustomThemeSpec>) => {
    const { spec: next, corrections } = clampCustomTheme({ ...spec, ...patch });
    setLastCorrection(corrections.find((c) => c.field === "accent") ?? corrections[0] ?? null);
    onChange(next);
  };
  const setMode = (mode: CustomThemeMode) => {
    // A background outside the new mood's band is replaced, not clamped to
    // its edge: white clamped into the dark band is a grey nobody chose.
    const l = hexToHsl(spec.background).l;
    const [nlo, nhi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
    const background = l >= nlo && l <= nhi ? spec.background : defaultCustomTheme(mode).background;
    set({ mode, background });
  };
  // "Take from…": the chosen bundled theme's swatch in the current mood —
  // NOT the live tokens, which are this theme's own once the editor is open
  // (that is why the earlier button appeared to do nothing).
  const adoptFrom = (id: string) => {
    const def = AVAILABLE_THEMES.find((d) => d.id === id);
    if (!def) return;
    const sw = def.swatch[spec.mode] ?? def.swatch[def.modes[0]];
    if (!sw) return;
    setLastCorrection(null);
    onChange(customThemeFromSwatch(sw, spec.mode, spec));
  };

  // The colour rows are the shared SwatchGrid (plan "Farbwahl überall",
  // 2026-09-04) — this page is where the grid was born.
  const ratioLine = (label: string, ratio: number, min: number, note?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--text-sm)" }}>
      <span>{label}</span>
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{formatRatio(ratio)}</b>
      <span className={`pv-chip pv-chip--sm${ratio >= min ? "" : " pv-chip--warning"}`}>{ratio >= min ? `✓ ${note ?? "AA"}` : "!"}</span>
    </div>
  );

  return (
    <div data-testid="custom-theme-editor">
      {/* The preview paints from the resolved colours, not from the live tokens:
          it must show the spec while a bundled theme is still active. */}
      <div aria-hidden="true" style={{ background: colors.background, color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: "var(--radius-md)", overflow: "hidden", fontSize: "var(--text-xs)", fontFamily: spec.fontUi ? `"${spec.fontUi}", var(--font-ui)` : "var(--font-ui)", marginBottom: "var(--space-4)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", minHeight: 110 }}>
          <div style={{ background: colors.surface, padding: "var(--space-3)", display: "grid", gap: "var(--space-2)", alignContent: "start" }}>
            <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.accent }} />
            <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.textFaint, opacity: 0.5 }} />
            <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.textFaint, opacity: 0.5 }} />
          </div>
          <div style={{ padding: "var(--space-3)" }}>
            <div style={{ fontWeight: 600, fontSize: "var(--text-md)", marginBottom: "var(--space-1)" }}>{t("settings.customThemePreviewTitle")}</div>
            <div style={{ color: colors.textMuted, marginBottom: "var(--space-2)", lineHeight: 1.4, fontSize: "var(--text-ui)" }}>{t("settings.customThemePreviewBody")}</div>
            <span style={{ display: "inline-block", background: colors.accent, color: colors.accentOn, borderRadius: "var(--radius-pill)", padding: "var(--space-1) var(--space-3)", fontWeight: 500, fontSize: "var(--text-ui)" }}>{t("settings.customThemePreviewButton")}</span>
          </div>
        </div>
      </div>

      <SettingCard label={t("settings.groupColors")}>
        <SettingRow label={t("settings.customThemeMode")}>
          <Segmented
            ariaLabel={t("settings.customThemeMode")}
            size="sm"
            value={spec.mode}
            onChange={(v) => setMode(v as CustomThemeMode)}
            options={[{ value: "light", label: t("settings.themeLight") }, { value: "dark", label: t("settings.themeDark") }]}
          />
        </SettingRow>
        <SettingRow label={t("settings.customThemeBackground")} desc={t("settings.customThemeBackgroundHint", { lo: Math.round(lo * 100), hi: Math.round(hi * 100) })}>
          <SwatchGrid
            ariaLabel={t("settings.customThemeBackground")}
            presets={customBackgroundPresets(spec.mode)}
            value={spec.background}
            onPick={(hex) => set({ background: hex })}
            free={{ label: t("settings.customThemeBackground"), onChange: (hex) => set({ background: hex }) }}
          />
        </SettingRow>
        <SettingRow label={t("settings.customThemeAccent")} desc={t("settings.customThemeAccentHint", { min: CUSTOM_ACCENT_MIN_CONTRAST })}>
          <SwatchGrid
            ariaLabel={t("settings.customThemeAccent")}
            presets={customAccentPresets()}
            value={spec.accent}
            onPick={(hex) => set({ accent: hex })}
            free={{ label: t("settings.customThemeAccent"), onChange: (hex) => set({ accent: hex }) }}
          />
        </SettingRow>
        <SettingRow label={t("settings.customThemeText")} desc={t("settings.customThemeTextHint")}>
          <SwatchGrid presets={[colors.textMain, colors.textMuted, colors.textFaint]} readOnly />
        </SettingRow>
        {lastCorrection && (
          <Banner kind="warning" rounded>
            {lastCorrection.field === "accent"
              ? t("settings.customThemeCorrected", { from: lastCorrection.from, ratio: formatRatio(lastCorrection.ratio ?? 0), to: lastCorrection.to })
              : t("settings.customThemeBgCorrected", { from: lastCorrection.from, to: lastCorrection.to })}
          </Banner>
        )}
      </SettingCard>

      <SettingCard label={t("settings.groupShape")}>
        <SettingRow label={t("settings.customThemeFontUi")} desc={t("settings.customThemeFontUiHint")}>
          <div style={{ width: "100%" }}>
            <FontField
              value={spec.fontUi}
              onChange={(css) => set({ fontUi: css })}
              defaultLabel={t("settings.fontFieldDefault", { font: designFont })}
              defaultHint={t("settings.fontFieldDefaultHint")}
              ariaLabel={t("settings.customThemeFontUi")}
              data-testid="custom-theme-font"
            />
          </div>
        </SettingRow>
        <SettingRow label={t("settings.customThemeRadius")}>
          <Segmented
            ariaLabel={t("settings.customThemeRadius")}
            size="sm"
            value={spec.radius}
            onChange={(v) => set({ radius: v as CustomThemeRadius })}
            options={[
              { value: "sharp", label: t("settings.radiusSharp") },
              { value: "normal", label: t("settings.radiusNormal") },
              { value: "soft", label: t("settings.radiusSoft") },
            ]}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("settings.customThemeContrast")}>
        {/* Same inset as a settings row (finding 2026-09-04: the lines sat on the card's edge). */}
        <div style={{ display: "grid", gap: "var(--space-1)", padding: "var(--space-3) var(--space-4)" }}>
          {ratioLine(t("settings.contrastTextOnBg"), ratios.textOnBackground, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST)}
          {ratioLine(t("settings.contrastAccentOnBg"), ratios.accentOnBackground, CUSTOM_ACCENT_MIN_CONTRAST)}
          {ratioLine(t("settings.contrastOnAccent"), ratios.onAccent, CUSTOM_ACCENT_MIN_CONTRAST, t("settings.contrastAuto"))}
        </div>
      </SettingCard>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center", paddingTop: "var(--space-2)" }}>
        <Button variant="ghost" size="sm" onClick={() => { setLastCorrection(null); onChange(defaultCustomTheme(spec.mode)); }}>
          {t("settings.customThemeReset")}
        </Button>
        <Select
          ariaLabel={t("settings.customThemeAdoptFrom")}
          value=""
          onChange={adoptFrom}
          size="sm"
          minWidth="16rem"
          data-testid="custom-theme-adopt-from"
          options={[
            { value: "", label: t("settings.customThemeAdoptFrom"), disabled: true },
            ...AVAILABLE_THEMES.filter((d) => !d.unlock).map((d) => {
              const sw = d.swatch[spec.mode] ?? d.swatch[d.modes[0]];
              return { value: d.id, label: t(`themes.names.${d.id}`, { defaultValue: d.label }), swatch: sw?.accent };
            }),
          ]}
        />
      </div>
    </div>
  );
};
