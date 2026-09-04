import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  FontCatalogPicker,
  GroupCard,
  RowList,
  SectionLabel,
  Segmented,
  SettingField,
  TextInput,
  clampCustomTheme,
  customAccentPresets,
  customBackgroundPresets,
  customThemeColors,
  customThemeContrast,
  defaultCustomTheme,
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

/**
 * The phone's half of the user theme (plan 2026-09-04, P2): the same few
 * choices as the desktop editor, as the appearance screen's own rows —
 * preview on top, then mood, ground, accent, font, corners, and the contrast
 * readout. Same derivation, same corrections, same words.
 */
export function CustomThemeRows({ spec, onChange }: { spec: CustomThemeSpec; onChange: (spec: CustomThemeSpec) => void }) {
  const { t } = useTranslation();
  const [lastCorrection, setLastCorrection] = useState<CustomThemeCorrection | null>(null);
  const colors = useMemo(() => customThemeColors(spec), [spec]);
  const ratios = useMemo(() => customThemeContrast(spec), [spec]);
  const [lo, hi] = CUSTOM_BACKGROUND_LIGHTNESS[spec.mode];

  const set = (patch: Partial<CustomThemeSpec>) => {
    const { spec: next, corrections } = clampCustomTheme({ ...spec, ...patch });
    setLastCorrection(corrections.find((c) => c.field === "accent") ?? corrections[0] ?? null);
    onChange(next);
  };
  const setMode = (mode: CustomThemeMode) => {
    const l = hexToHsl(spec.background).l;
    const [nlo, nhi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
    set({ mode, background: l >= nlo && l <= nhi ? spec.background : defaultCustomTheme(mode).background });
  };
  const grid = (values: string[], current: string, label: string, pick: (hex: string) => void) => (
    <div className="m-colorgrid" role="group" aria-label={label}>
      {values.map((hex) => (
        <button
          key={hex}
          aria-label={hex}
          aria-pressed={hex === current}
          className={hex === current ? "is-on" : undefined}
          onClick={() => pick(hex)}
          style={{ background: hex }}
        />
      ))}
      <label className="m-row">
        <input aria-label={label} type="color" value={current} onChange={(e) => pick(e.target.value)} />
      </label>
    </div>
  );
  const ratioLine = (label: string, ratio: number, min: number) => `${label}: ${formatRatio(ratio)} ${ratio >= min ? "✓" : "!"}`;

  return (
    <div data-testid="custom-theme-rows">
      <SectionLabel>{t("settings.customThemePreview")}</SectionLabel>
      <div aria-hidden="true" className="pv-card pv-card--flush" style={{ background: colors.background, color: colors.textMain, borderColor: colors.border, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", minHeight: "calc(var(--space-8) * 3)" }}>
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

      <SectionLabel>{t("settings.customThemeMode")}</SectionLabel>
      <Segmented
        ariaLabel={t("settings.customThemeMode")}
        options={[{ value: "light", label: t("settings.themeLight") }, { value: "dark", label: t("settings.themeDark") }]}
        value={spec.mode}
        onChange={(v) => setMode(v as CustomThemeMode)}
      />

      <SectionLabel>{t("settings.customThemeBackground")}</SectionLabel>
      {grid(customBackgroundPresets(spec.mode), spec.background, t("settings.customThemeBackground"), (hex) => set({ background: hex }))}
      <p className="m-hint">{t("settings.customThemeBackgroundHint", { lo: Math.round(lo * 100), hi: Math.round(hi * 100) })}</p>

      <SectionLabel>{t("settings.customThemeAccent")}</SectionLabel>
      {grid(customAccentPresets(), spec.accent, t("settings.customThemeAccent"), (hex) => set({ accent: hex }))}
      <p className="m-hint">{t("settings.customThemeAccentHint", { min: CUSTOM_ACCENT_MIN_CONTRAST })}</p>
      {lastCorrection && (
        <Banner kind="warning" rounded>
          {lastCorrection.field === "accent"
            ? t("settings.customThemeCorrected", { from: lastCorrection.from, ratio: formatRatio(lastCorrection.ratio ?? 0), to: lastCorrection.to })
            : t("settings.customThemeBgCorrected", { from: lastCorrection.from, to: lastCorrection.to })}
        </Banner>
      )}

      <SectionLabel>{t("settings.customThemeFontUi")}</SectionLabel>
      <FontCatalogPicker value={spec.fontUi} onPick={(font) => set({ fontUi: font.css })} />
      <GroupCard>
        <RowList>
          <SettingField label={t("settings.customThemeFontDefault")}>
            <TextInput onChange={(e) => set({ fontUi: e.target.value })} value={spec.fontUi} />
          </SettingField>
        </RowList>
      </GroupCard>
      <p className="m-hint">{t("settings.customThemeFontUiHint")}</p>

      <SectionLabel>{t("settings.customThemeRadius")}</SectionLabel>
      <Segmented
        ariaLabel={t("settings.customThemeRadius")}
        options={[
          { value: "sharp", label: t("settings.radiusSharp") },
          { value: "normal", label: t("settings.radiusNormal") },
          { value: "soft", label: t("settings.radiusSoft") },
        ]}
        value={spec.radius}
        onChange={(v) => set({ radius: v as CustomThemeRadius })}
      />

      <SectionLabel>{t("settings.customThemeContrast")}</SectionLabel>
      <p className="m-hint">
        {ratioLine(t("settings.contrastTextOnBg"), ratios.textOnBackground, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST)}
        {" · "}
        {ratioLine(t("settings.contrastAccentOnBg"), ratios.accentOnBackground, CUSTOM_ACCENT_MIN_CONTRAST)}
        {" · "}
        {ratioLine(t("settings.contrastOnAccent"), ratios.onAccent, CUSTOM_ACCENT_MIN_CONTRAST)}
        {" · "}
        {t("settings.customThemeTextHint")}
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => { setLastCorrection(null); onChange(defaultCustomTheme(spec.mode)); }}>
          {t("settings.customThemeReset")}
        </Button>
      </div>
    </div>
  );
}
