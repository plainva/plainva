import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import {
  Banner,
  Button,
  FontCatalogPicker,
  ICON,
  Segmented,
  TextInput,
  clampCustomTheme,
  customAccentPresets,
  customBackgroundPresets,
  customThemeColors,
  customThemeContrast,
  defaultCustomTheme,
  formatRatio,
  hexToHsl,
  normalizeHex,
  CUSTOM_ACCENT_MIN_CONTRAST,
  CUSTOM_BACKGROUND_LIGHTNESS,
  CUSTOM_TEXT_SECONDARY_MIN_CONTRAST,
  type CustomThemeCorrection,
  type CustomThemeMode,
  type CustomThemeRadius,
  type CustomThemeSpec,
} from "@plainva/ui";

/**
 * The user's own theme (plan 2026-09-04, P2): the few things a person may
 * choose, and the readout of what the choice resolves to. Text colours are
 * shown, never edited; a pale accent is corrected and the correction is
 * said in a sentence. Every change persists at once — there is no "apply",
 * the preview IS the app.
 */
export interface CustomThemeEditorProps {
  spec: CustomThemeSpec;
  onChange: (spec: CustomThemeSpec) => void;
}

/** A CSS colour as the browser resolves it → `#rrggbb` (null when it cannot). */
function cssColorToHex(value: string): string | null {
  const direct = normalizeHex(value.trim());
  if (direct) return direct;
  if (typeof document === "undefined") return null;
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(resolved);
  if (!m) return null;
  const part = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${part(m[1])}${part(m[2])}${part(m[3])}`;
}

/** The theme on screen right now, as a starting point for one's own. */
export function readCurrentThemeSpec(fallback: CustomThemeSpec): CustomThemeSpec {
  if (typeof document === "undefined") return fallback;
  const root = document.documentElement;
  const mode: CustomThemeMode = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const read = (token: string) => cssColorToHex(getComputedStyle(root).getPropertyValue(token));
  const base = defaultCustomTheme(mode);
  return clampCustomTheme({
    ...fallback,
    mode,
    background: read("--bg-primary") ?? base.background,
    accent: read("--accent-color") ?? base.accent,
  }).spec;
}

export const CustomThemeEditor: React.FC<CustomThemeEditorProps> = ({ spec, onChange }) => {
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
    // A background outside the new mood's band is replaced, not clamped to
    // its edge: white clamped into the dark band is a grey nobody chose.
    const l = hexToHsl(spec.background).l;
    const [nlo, nhi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
    const background = l >= nlo && l <= nhi ? spec.background : defaultCustomTheme(mode).background;
    set({ mode, background });
  };

  const swatch = (hex: string, active: boolean, label: string, onPick: () => void) => (
    <button
      key={hex}
      type="button"
      className="pv-btn pv-btn--ghost pv-btn--sm"
      aria-label={label}
      aria-pressed={active}
      data-tip={hex}
      onClick={onPick}
      style={{
        width: "var(--control-md)", height: "var(--control-md)", minWidth: 0, padding: 0, borderRadius: "50%",
        background: hex, border: active ? "2px solid var(--text-main)" : "1px solid var(--border-color)", flexShrink: 0,
      }}
    >
      {active ? <Check size={ICON.meta} style={{ color: colors.accentOn }} aria-hidden="true" /> : null}
    </button>
  );
  const colorInput = (value: string, label: string, onPick: (hex: string) => void) => (
    <input
      type="color"
      className="pv-field pv-field--compact"
      aria-label={label}
      value={value}
      onChange={(e) => onPick(e.target.value)}
      style={{ width: "var(--control-lg)", padding: 0, cursor: "pointer" }}
    />
  );
  const row = (label: string, hint: string | null, control: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 3fr", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-2) 0", borderBottom: "1px solid var(--border-color-light)" }}>
      <div>
        <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>{label}</div>
        {hint ? <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{hint}</div> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", minWidth: 0 }}>{control}</div>
    </div>
  );
  const ratioLine = (label: string, ratio: number, min: number, note?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--text-sm)" }}>
      <span>{label}</span>
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{formatRatio(ratio)}</b>
      <span className={`pv-chip pv-chip--sm${ratio >= min ? "" : " pv-chip--warning"}`}>{ratio >= min ? `✓ ${note ?? "AA"}` : "!"}</span>
    </div>
  );

  return (
    <div data-testid="custom-theme-editor" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(200px, 260px)", gap: "var(--space-4)", width: "100%", alignItems: "start" }}>
      <div>
        {row(t("settings.customThemeMode"), null, (
          <Segmented
            ariaLabel={t("settings.customThemeMode")}
            size="sm"
            value={spec.mode}
            onChange={(v) => setMode(v as CustomThemeMode)}
            options={[{ value: "light", label: t("settings.themeLight") }, { value: "dark", label: t("settings.themeDark") }]}
          />
        ))}
        {row(t("settings.customThemeBackground"), t("settings.customThemeBackgroundHint", { lo: Math.round(lo * 100), hi: Math.round(hi * 100) }), (
          <>
            {customBackgroundPresets(spec.mode).map((hex) => swatch(hex, hex === spec.background, hex, () => set({ background: hex })))}
            {colorInput(spec.background, t("settings.customThemeBackground"), (hex) => set({ background: hex }))}
          </>
        ))}
        {row(t("settings.customThemeAccent"), t("settings.customThemeAccentHint", { min: CUSTOM_ACCENT_MIN_CONTRAST }), (
          <>
            {customAccentPresets().map((hex) => swatch(hex, hex === spec.accent, hex, () => set({ accent: hex })))}
            {colorInput(spec.accent, t("settings.customThemeAccent"), (hex) => set({ accent: hex }))}
          </>
        ))}
        {row(t("settings.customThemeText"), t("settings.customThemeTextHint"), (
          <>
            {[colors.textMain, colors.textMuted, colors.textFaint].map((hex) => (
              <span key={hex} aria-hidden="true" data-tip={hex} style={{ width: "var(--control-md)", height: "var(--control-md)", borderRadius: "50%", background: hex, border: "1px solid var(--border-color)", display: "inline-block" }} />
            ))}
          </>
        ))}
        {row(t("settings.customThemeFontUi"), t("settings.customThemeFontUiHint"), (
          <div style={{ width: "100%", display: "grid", gap: "var(--space-2)" }}>
            <TextInput
              aria-label={t("settings.customThemeFontUi")}
              value={spec.fontUi}
              placeholder={t("settings.customThemeFontDefault")}
              onChange={(e) => set({ fontUi: e.target.value })}
            />
            <FontCatalogPicker value={spec.fontUi} onPick={(font) => set({ fontUi: font.css })} />
          </div>
        ))}
        {row(t("settings.customThemeRadius"), null, (
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
        ))}
        {row(t("settings.customThemeContrast"), null, (
          <div style={{ display: "grid", gap: "var(--space-1)", width: "100%" }}>
            {ratioLine(t("settings.contrastTextOnBg"), ratios.textOnBackground, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST)}
            {ratioLine(t("settings.contrastAccentOnBg"), ratios.accentOnBackground, CUSTOM_ACCENT_MIN_CONTRAST)}
            {ratioLine(t("settings.contrastOnAccent"), ratios.onAccent, CUSTOM_ACCENT_MIN_CONTRAST, t("settings.contrastAuto"))}
          </div>
        ))}
        {lastCorrection && (
          <div style={{ paddingTop: "var(--space-3)" }}>
            <Banner kind="warning" rounded>
              {lastCorrection.field === "accent"
                ? t("settings.customThemeCorrected", { from: lastCorrection.from, ratio: formatRatio(lastCorrection.ratio ?? 0), to: lastCorrection.to })
                : t("settings.customThemeBgCorrected", { from: lastCorrection.from, to: lastCorrection.to })}
            </Banner>
          </div>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", paddingTop: "var(--space-3)" }}>
          <Button variant="ghost" size="sm" onClick={() => { setLastCorrection(null); onChange(defaultCustomTheme(spec.mode)); }}>
            {t("settings.customThemeReset")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setLastCorrection(null); onChange(readCurrentThemeSpec(spec)); }}>
            {t("settings.customThemeAdopt")}
          </Button>
        </div>
      </div>

      {/* The preview paints from the resolved colours, not from the live tokens:
          the card must show the spec while a bundled theme is still active. */}
      <div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "var(--space-1)" }}>{t("settings.customThemePreview")}</div>
        <div aria-hidden="true" style={{ background: colors.background, color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: "var(--radius-sm)", overflow: "hidden", fontSize: "var(--text-xs)", fontFamily: spec.fontUi ? `"${spec.fontUi}", var(--font-ui)` : "var(--font-ui)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", minHeight: 120 }}>
            <div style={{ background: colors.surface, padding: "var(--space-2)", display: "grid", gap: "var(--space-1)", alignContent: "start" }}>
              <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.accent }} />
              <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.textFaint, opacity: 0.5 }} />
              <span style={{ display: "block", height: 6, borderRadius: "var(--radius-xs)", background: colors.textFaint, opacity: 0.5 }} />
            </div>
            <div style={{ padding: "var(--space-2)" }}>
              <div style={{ fontWeight: 600, fontSize: "var(--text-ui)", marginBottom: "var(--space-1)" }}>{t("settings.customThemePreviewTitle")}</div>
              <div style={{ color: colors.textMuted, marginBottom: "var(--space-2)", lineHeight: 1.4 }}>{t("settings.customThemePreviewBody")}</div>
              <span style={{ display: "inline-block", background: colors.accent, color: colors.accentOn, borderRadius: "var(--radius-pill)", padding: "var(--space-1) var(--space-2)", fontWeight: 500 }}>{t("settings.customThemePreviewButton")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
