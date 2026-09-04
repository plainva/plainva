/**
 * The user's own theme (plan 2026-09-04, P2, decisions E2/E3).
 *
 * A thirteenth registry entry whose tokens come from a small SPEC instead of
 * a CSS file: a mood (light or dark), a background from a bounded lightness
 * range, a free accent, a UI font and a corner-radius step. Everything else is
 * DERIVED — text colours are never chosen, so text can never vanish into the
 * ground; the accent is measured against the background and corrected below
 * 3:1, and the correction is reported rather than applied in silence. The
 * remaining tokens (containers, state layers, focus ring) fall out of the
 * `color-mix()` rules every theme already relies on.
 *
 * Pure derivation in this file; `applyCustomTheme` is the only DOM touch and
 * writes inline custom properties on `<html>` — the same mechanism the content
 * font uses, and the one thing that beats every `[data-theme-name]` rule.
 */
import { contrastRatio, hexToHsl, hslToHex, mixHex, normalizeHex, nudgeToContrast, withAlpha } from "./contrast";
import { FONT_FAMILY_STACKS, sanitizeFontName } from "./contentFont";

export const CUSTOM_THEME_ID = "custom";

export type CustomThemeMode = "light" | "dark";
export type CustomThemeRadius = "sharp" | "normal" | "soft";

export interface CustomThemeSpec {
  mode: CustomThemeMode;
  /** `#rrggbb`, lightness inside `CUSTOM_BACKGROUND_LIGHTNESS[mode]`. */
  background: string;
  /** `#rrggbb`, free — corrected to `CUSTOM_ACCENT_MIN_CONTRAST` against the background. */
  accent: string;
  /** A font family name for the chrome; empty = the theme's default stack. */
  fontUi: string;
  radius: CustomThemeRadius;
}

/** Where a background may sit: light grounds stay light, dark grounds dark.
 * A mid-tone ground is the one place neither dark nor light text is safe. */
export const CUSTOM_BACKGROUND_LIGHTNESS: Record<CustomThemeMode, readonly [number, number]> = {
  light: [0.88, 1],
  dark: [0, 0.18],
};
/** WCAG AA for UI components and large text: the floor for the accent. */
export const CUSTOM_ACCENT_MIN_CONTRAST = 3;
/** WCAG AAA for body text: what the derived main text reaches. */
export const CUSTOM_TEXT_MAIN_MIN_CONTRAST = 7;
/** WCAG AA for normal text: the floor for muted and faint text. */
export const CUSTOM_TEXT_SECONDARY_MIN_CONTRAST = 4.5;

const WHITE = hslToHex({ h: 0, s: 0, l: 1 });
const BLACK = hslToHex({ h: 0, s: 0, l: 0 });

/** Petrol's accent, as the starting point — not a literal, so the lint that
 * keeps colours out of components does not need an exception here. */
const PETROL_ACCENT = hslToHex({ h: 175, s: 0.77, l: 0.26 });

export function defaultCustomTheme(mode: CustomThemeMode = "light"): CustomThemeSpec {
  return {
    mode,
    background: mode === "light" ? WHITE : hslToHex({ h: 175, s: 0.3, l: 0.08 }),
    accent: mode === "light" ? PETROL_ACCENT : hslToHex({ h: 172, s: 0.66, l: 0.5 }),
    fontUi: "",
    radius: "normal",
  };
}

/** Six grounds per mood the picker offers before the free choice. */
export function customBackgroundPresets(mode: CustomThemeMode): string[] {
  const light = [
    { h: 0, s: 0, l: 1 },
    { h: 0, s: 0, l: 0.96 },
    { h: 40, s: 0.3, l: 0.95 },
    { h: 210, s: 0.35, l: 0.96 },
    { h: 150, s: 0.2, l: 0.96 },
    { h: 340, s: 0.3, l: 0.96 },
  ];
  const dark = [
    { h: 0, s: 0, l: 0.06 },
    { h: 0, s: 0, l: 0.13 },
    { h: 200, s: 0.3, l: 0.1 },
    { h: 260, s: 0.25, l: 0.11 },
    { h: 150, s: 0.2, l: 0.1 },
    { h: 20, s: 0.2, l: 0.1 },
  ];
  return (mode === "light" ? light : dark).map(hslToHex);
}

/** Accents offered before the free choice: saturated, and readable on both moods once corrected. */
export function customAccentPresets(): string[] {
  return [
    { h: 175, s: 0.77, l: 0.26 },
    { h: 221, s: 0.83, l: 0.53 },
    { h: 297, s: 0.42, l: 0.4 },
    { h: 27, s: 0.96, l: 0.35 },
    { h: 347, s: 0.77, l: 0.41 },
    { h: 84, s: 0.81, l: 0.27 },
    { h: 0, s: 0, l: 0.2 },
  ].map(hslToHex);
}

export interface CustomThemeCorrection {
  field: "background" | "accent";
  from: string;
  to: string;
  /** The contrast the original had against the background (accent only). */
  ratio?: number;
}

/** Everything the spec allows, applied: invalid colours fall back, the
 * background lightness is clamped into its band, the accent is nudged to the
 * floor. Idempotent — clamping a clamped spec changes nothing. */
export function clampCustomTheme(input: CustomThemeSpec): { spec: CustomThemeSpec; corrections: CustomThemeCorrection[] } {
  const mode: CustomThemeMode = input.mode === "dark" ? "dark" : "light";
  const base = defaultCustomTheme(mode);
  const corrections: CustomThemeCorrection[] = [];

  let background = normalizeHex(input.background) ?? base.background;
  const [lo, hi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
  const bgHsl = hexToHsl(background);
  // Hex quantises lightness to ~1/255: a ground clamped onto the band's edge
  // must not read as outside it on the next pass.
  const EPS = 0.004;
  if (bgHsl.l < lo - EPS || bgHsl.l > hi + EPS) {
    const to = hslToHex({ ...bgHsl, l: Math.max(lo, Math.min(hi, bgHsl.l)) });
    corrections.push({ field: "background", from: background, to });
    background = to;
  }

  let accent = normalizeHex(input.accent) ?? base.accent;
  const nudged = nudgeToContrast(accent, background, CUSTOM_ACCENT_MIN_CONTRAST);
  if (nudged.changed) {
    corrections.push({ field: "accent", from: accent, to: nudged.hex, ratio: contrastRatio(accent, background) });
    accent = nudged.hex;
  }

  const radius: CustomThemeRadius = input.radius === "sharp" || input.radius === "soft" ? input.radius : "normal";
  const fontUi = typeof input.fontUi === "string" ? sanitizeFontName(input.fontUi) : "";
  return { spec: { mode, background, accent, fontUi, radius }, corrections };
}

/** A stored value of unknown shape → a spec, or null when it is not one. */
export function parseCustomTheme(raw: unknown): CustomThemeSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.mode !== "light" && o.mode !== "dark") return null;
  if (typeof o.background !== "string" || typeof o.accent !== "string") return null;
  return clampCustomTheme({
    mode: o.mode,
    background: o.background,
    accent: o.accent,
    fontUi: typeof o.fontUi === "string" ? o.fontUi : "",
    radius: o.radius === "sharp" || o.radius === "soft" ? o.radius : "normal",
  }).spec;
}

const RADIUS_SCALE: Record<Exclude<CustomThemeRadius, "normal">, Record<string, string>> = {
  sharp: { "--radius-xs": "2px", "--radius-sm": "4px", "--radius-md": "6px", "--radius-lg": "8px", "--radius-xl": "10px" },
  soft: { "--radius-xs": "6px", "--radius-sm": "12px", "--radius-md": "16px", "--radius-lg": "20px", "--radius-xl": "24px" },
};

/** Text on the ground: the ground's own hue, damped, at a lightness that
 * clears the floor — then nudged in case the hue is bright. */
function derivedText(background: string, lightness: number, min: number): string {
  const { h, s } = hexToHsl(background);
  const seed = hslToHex({ h, s: Math.min(s, 0.25), l: lightness });
  return nudgeToContrast(seed, background, min).hex;
}

export interface CustomThemeColors {
  background: string;
  surface: string;
  hover: string;
  textMain: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentOn: string;
  border: string;
  borderLight: string;
}

/** The solid colours the spec resolves to — what tokens, swatches and the
 * contrast meter all read from. */
export function customThemeColors(input: CustomThemeSpec): CustomThemeColors {
  const { spec } = clampCustomTheme(input);
  const light = spec.mode === "light";
  const textMain = derivedText(spec.background, light ? 0.11 : 0.88, CUSTOM_TEXT_MAIN_MIN_CONTRAST);
  const textMuted = derivedText(spec.background, light ? 0.36 : 0.68, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST);
  const textFaint = derivedText(spec.background, light ? 0.42 : 0.6, CUSTOM_TEXT_SECONDARY_MIN_CONTRAST);
  const accentHsl = hexToHsl(spec.accent);
  const accentHover = hslToHex({ ...accentHsl, l: light ? Math.max(0, accentHsl.l - 0.08) : Math.min(1, accentHsl.l + 0.08) });
  const accentOn = contrastRatio(WHITE, spec.accent) >= contrastRatio(BLACK, spec.accent) ? WHITE : BLACK;
  return {
    background: spec.background,
    surface: mixHex(spec.background, textMain, 0.04),
    hover: mixHex(spec.background, textMain, 0.09),
    textMain,
    textMuted,
    textFaint,
    accent: spec.accent,
    accentHover,
    accentOn,
    border: mixHex(spec.background, textMain, 0.16),
    borderLight: mixHex(spec.background, textMain, 0.09),
  };
}

/** What the picker card and the preview show. */
export function customThemeSwatch(spec: CustomThemeSpec): { bg: string; surface: string; text: string; accent: string } {
  const c = customThemeColors(spec);
  return { bg: c.background, surface: c.surface, text: c.textMain, accent: c.accent };
}

/** The three ratios the editor reports. */
export function customThemeContrast(spec: CustomThemeSpec): { textOnBackground: number; accentOnBackground: number; onAccent: number } {
  const c = customThemeColors(spec);
  return {
    textOnBackground: contrastRatio(c.textMain, c.background),
    accentOnBackground: contrastRatio(c.accent, c.background),
    onAccent: contrastRatio(c.accentOn, c.accent),
  };
}

/** Every custom property the theme may write — cleared as a set. */
export const CUSTOM_TOKEN_NAMES: readonly string[] = [
  "--bg-primary", "--bg-secondary", "--bg-hover", "--bg-active",
  "--text-main", "--text-muted", "--text-faint",
  "--accent-color", "--accent-color-hover", "--accent-on",
  "--border-color", "--border-color-light",
  "--selection-bg", "--active-line-bg", "--code-bg", "--quote-border",
  "--switch-knob",
  "--font-ui", "--font-family",
  "--radius-xs", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl",
];

/** The complete token map for a spec. Only tokens the spec decides are
 * present; the rest stay with the base palette of the pinned mode. */
export function deriveCustomTokens(input: CustomThemeSpec): Record<string, string> {
  const { spec } = clampCustomTheme(input);
  const c = customThemeColors(spec);
  const tokens: Record<string, string> = {
    "--bg-primary": c.background,
    "--bg-secondary": c.surface,
    "--bg-hover": c.hover,
    "--bg-active": withAlpha(c.accent, 0.15),
    "--text-main": c.textMain,
    "--text-muted": c.textMuted,
    "--text-faint": c.textFaint,
    "--accent-color": c.accent,
    "--accent-color-hover": c.accentHover,
    "--accent-on": c.accentOn,
    "--border-color": c.border,
    "--border-color-light": c.borderLight,
    "--selection-bg": withAlpha(c.accent, 0.16),
    "--active-line-bg": withAlpha(c.accent, 0.05),
    "--code-bg": mixHex(c.background, c.textMain, 0.05),
    "--quote-border": mixHex(c.background, c.textMain, 0.22),
    "--switch-knob": WHITE,
  };
  if (spec.fontUi) {
    const stack = `"${spec.fontUi}", ${FONT_FAMILY_STACKS.sans}`;
    tokens["--font-ui"] = stack;
    tokens["--font-family"] = stack;
  }
  if (spec.radius !== "normal") Object.assign(tokens, RADIUS_SCALE[spec.radius]);
  return tokens;
}

/** Writes the spec's tokens onto `<html>`; tokens the spec does not decide
 * are removed so a previous spec cannot linger. No-op without a DOM. */
export function applyCustomTheme(spec: CustomThemeSpec): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  const tokens = deriveCustomTokens(spec);
  for (const name of CUSTOM_TOKEN_NAMES) {
    if (name in tokens) style.setProperty(name, tokens[name]);
    else style.removeProperty(name);
  }
}

/** Removes every custom-theme token — the bundled themes take over again. */
export function clearCustomTheme(): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  for (const name of CUSTOM_TOKEN_NAMES) style.removeProperty(name);
}
