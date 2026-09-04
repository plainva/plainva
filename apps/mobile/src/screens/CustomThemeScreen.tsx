import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AVAILABLE_THEMES,
  Banner,
  Button,
  GroupCard,
  Row,
  RowList,
  SectionLabel,
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
import { AppBar } from "../components/AppBar";
import { SwatchSheet } from "../components/SwatchSheet";
import { FontPickSheet } from "../components/FontPickSheet";
import { mSelect } from "../services/mobileDialogs";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * "Mein Design" on the phone (plan 2026-09-04, A2): the screen the pencil on
 * the theme card opens. Preview first; every row opens its own sheet or
 * picker and shows what is chosen — the same few choices, the same
 * derivation and the same corrections as the desktop page.
 */
export function CustomThemeScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [spec, setSpec] = useState<CustomThemeSpec>(() => clampCustomTheme(getMobileSettings().customTheme).spec);
  const [sheet, setSheet] = useState<"background" | "accent" | "font" | null>(null);
  const [lastCorrection, setLastCorrection] = useState<CustomThemeCorrection | null>(null);
  const colors = useMemo(() => customThemeColors(spec), [spec]);
  const ratios = useMemo(() => customThemeContrast(spec), [spec]);
  const designFont = useMemo(
    () => (typeof document === "undefined" ? "" : firstFontFamily(getComputedStyle(document.documentElement).getPropertyValue("--font-ui"))),
    [],
  );
  const [lo, hi] = CUSTOM_BACKGROUND_LIGHTNESS[spec.mode];

  const commit = (next: CustomThemeSpec) => {
    setSpec(next);
    void updateMobileSettings({ customTheme: next });
  };
  const set = (patch: Partial<CustomThemeSpec>) => {
    const { spec: next, corrections } = clampCustomTheme({ ...spec, ...patch });
    setLastCorrection(corrections.find((c) => c.field === "accent") ?? corrections[0] ?? null);
    commit(next);
  };
  const pickMode = () => {
    void mSelect({
      title: t("settings.customThemeMode"),
      options: [{ value: "light", label: t("settings.themeLight") }, { value: "dark", label: t("settings.themeDark") }],
      value: spec.mode,
    }).then((v) => {
      if (v !== "light" && v !== "dark") return;
      const mode = v as CustomThemeMode;
      const l = hexToHsl(spec.background).l;
      const [nlo, nhi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
      set({ mode, background: l >= nlo && l <= nhi ? spec.background : defaultCustomTheme(mode).background });
    });
  };
  const pickRadius = () => {
    void mSelect({
      title: t("settings.customThemeRadius"),
      options: [
        { value: "sharp", label: t("settings.radiusSharp") },
        { value: "normal", label: t("settings.radiusNormal") },
        { value: "soft", label: t("settings.radiusSoft") },
      ],
      value: spec.radius,
    }).then((v) => { if (v) set({ radius: v as CustomThemeRadius }); });
  };
  const adoptFrom = () => {
    const themes = AVAILABLE_THEMES.filter((d) => !d.unlock);
    void mSelect({
      title: t("settings.customThemeAdoptFrom"),
      options: themes.map((d) => ({ value: d.id, label: t(`themes.names.${d.id}`, { defaultValue: d.label }) })),
    }).then((id) => {
      const def = themes.find((d) => d.id === id);
      const sw = def ? (def.swatch[spec.mode] ?? def.swatch[def.modes[0]]) : undefined;
      if (!sw) return;
      setLastCorrection(null);
      commit(customThemeFromSwatch(sw, spec.mode, spec));
    });
  };
  const radiusLabel = { sharp: t("settings.radiusSharp"), normal: t("settings.radiusNormal"), soft: t("settings.radiusSoft") }[spec.radius];
  const dot = (hex: string) => (
    <i aria-hidden style={{ display: "inline-block", border: "1px solid var(--border-color)", borderRadius: "50%", background: hex, verticalAlign: "middle", width: "var(--space-4)", height: "var(--space-4)" }} />
  );
  const ratioText = (ratio: number, min: number) => `${formatRatio(ratio)} ${ratio >= min ? "✓" : "!"}`;

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("themes.names.custom")} />
      <div className="m-settings">
        <p className="m-hint">{t("settings.customThemePageDesc")}</p>
        <div aria-hidden="true" className="pv-card pv-card--flush" data-testid="custom-theme-preview" style={{ background: colors.background, color: colors.textMain, borderColor: colors.border, overflow: "hidden", fontFamily: spec.fontUi ? `"${spec.fontUi}", var(--font-ui)` : undefined }}>
          <div style={{ display: "grid", gridTemplateColumns: "calc(var(--space-8) + var(--space-6)) 1fr", minHeight: "calc(var(--space-8) * 3)" }}>
            <div style={{ background: colors.surface, padding: "var(--space-2)", display: "grid", gap: "var(--space-1)", alignContent: "start" }}>
              <span style={{ display: "block", height: "var(--space-1)", borderRadius: "var(--radius-xs)", background: colors.accent }} />
              <span style={{ display: "block", height: "var(--space-1)", borderRadius: "var(--radius-xs)", background: colors.textFaint, opacity: 0.5 }} />
            </div>
            <div style={{ padding: "var(--space-2)", fontSize: "var(--text-sm)" }}>
              <div style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>{t("settings.customThemePreviewTitle")}</div>
              <div style={{ color: colors.textMuted, marginBottom: "var(--space-2)" }}>{t("settings.customThemePreviewBody")}</div>
              <span style={{ display: "inline-block", background: colors.accent, color: colors.accentOn, borderRadius: "var(--radius-pill)", padding: "var(--space-1) var(--space-2)", fontWeight: 500 }}>{t("settings.customThemePreviewButton")}</span>
            </div>
          </div>
        </div>

        <SectionLabel>{t("settings.groupColors")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row title={t("settings.customThemeMode")} end={<span className="m-prop-val">{spec.mode === "light" ? t("settings.themeLight") : t("settings.themeDark")}</span>} onClick={pickMode} />
            <Row title={t("settings.customThemeBackground")} subtitle={t("settings.customThemeBackgroundHint", { lo: Math.round(lo * 100), hi: Math.round(hi * 100) })} end={dot(spec.background)} onClick={() => setSheet("background")} />
            <Row title={t("settings.customThemeAccent")} subtitle={t("settings.customThemeAccentHint", { min: CUSTOM_ACCENT_MIN_CONTRAST })} end={dot(spec.accent)} onClick={() => setSheet("accent")} />
            <Row title={t("settings.customThemeText")} subtitle={t("settings.customThemeTextHint")} end={<span>{dot(colors.textMain)} {dot(colors.textMuted)} {dot(colors.textFaint)}</span>} />
          </RowList>
        </GroupCard>
        {lastCorrection && (
          <Banner kind="warning" rounded>
            {lastCorrection.field === "accent"
              ? t("settings.customThemeCorrected", { from: lastCorrection.from, ratio: formatRatio(lastCorrection.ratio ?? 0), to: lastCorrection.to })
              : t("settings.customThemeBgCorrected", { from: lastCorrection.from, to: lastCorrection.to })}
          </Banner>
        )}

        <SectionLabel>{t("settings.groupShape")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row title={t("settings.customThemeFontUi")} subtitle={t("settings.customThemeFontUiHint")} end={<span className="m-prop-val">{spec.fontUi || t("settings.fontFieldDefault", { font: designFont })}</span>} onClick={() => setSheet("font")} />
            <Row title={t("settings.customThemeRadius")} end={<span className="m-prop-val">{radiusLabel}</span>} onClick={pickRadius} />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("settings.customThemeContrast")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row title={t("settings.contrastTextOnBg")} end={<span className="m-prop-val">{ratioText(ratios.textOnBackground, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST)}</span>} />
            <Row title={t("settings.contrastAccentOnBg")} end={<span className="m-prop-val">{ratioText(ratios.accentOnBackground, CUSTOM_ACCENT_MIN_CONTRAST)}</span>} />
            <Row title={t("settings.contrastOnAccent")} subtitle={t("settings.contrastAuto")} end={<span className="m-prop-val">{ratioText(ratios.onAccent, CUSTOM_ACCENT_MIN_CONTRAST)}</span>} />
          </RowList>
        </GroupCard>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => { setLastCorrection(null); commit(defaultCustomTheme(spec.mode)); }}>{t("settings.customThemeReset")}</Button>
          <Button variant="ghost" onClick={adoptFrom}>{t("settings.customThemeAdoptFrom")}</Button>
        </div>
      </div>

      {sheet === "background" && (
        <SwatchSheet title={t("settings.customThemeBackground")} hint={t("settings.customThemeBackgroundHint", { lo: Math.round(lo * 100), hi: Math.round(hi * 100) })} presets={customBackgroundPresets(spec.mode)} value={spec.background} onPick={(hex) => set({ background: hex })} onClose={() => setSheet(null)} />
      )}
      {sheet === "accent" && (
        <SwatchSheet title={t("settings.customThemeAccent")} hint={t("settings.customThemeAccentHint", { min: CUSTOM_ACCENT_MIN_CONTRAST })} presets={customAccentPresets()} value={spec.accent} onPick={(hex) => set({ accent: hex })} onClose={() => setSheet(null)} />
      )}
      {sheet === "font" && (
        <FontPickSheet title={t("settings.customThemeFontUi")} value={spec.fontUi} defaultLabel={t("settings.fontFieldDefault", { font: designFont })} defaultHint={t("settings.fontFieldDefaultHint")} onPick={(css) => { set({ fontUi: css }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
