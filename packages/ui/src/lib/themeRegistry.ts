/**
 * Shared theme registry + resolvers (Mobile M3E plan, package D2 — split out
 * of apps/desktop/src/services/theme.ts so both shells pick from ONE catalog).
 * Pure data + DOM appliers only; persistence (which theme is stored/unlocked)
 * stays per shell on its own ISettingsStore.
 */

export type ThemeMode = "light" | "dark";
export type ThemePref = "light" | "dark" | "system";
export type ThemeName = string;

/** Concrete preview colours for the settings cards (NOT CSS variables — the
 * preview must show a theme that is not active). */
export interface ThemeSwatch {
  bg: string;
  surface: string;
  text: string;
  accent: string;
}

/** A collectible palette variant of a theme (used by the LCARS easter egg —
 * each recognised Star Trek line unlocks one). Applied as `data-theme-variant`
 * on the document root. `label` is the English fallback; the UI translates via
 * the i18n key `themes.variants.<id>` when present. */
export interface ThemeVariantDef {
  id: string;
  label: string;
  /** Chip colour in the collection UI. */
  accent: string;
}

/**
 * A selectable theme. Axes on <html>:
 *  - `data-theme`         — resolved mode ("light" | "dark")
 *  - `data-theme-name`    — the theme id
 *  - `data-theme-variant` — optional collectible variant (themes with `variants`)
 * Themes are pure CSS token sets under src/themes/ — components only consume
 * CSS variables and never need to change. `label` is the English fallback; the
 * UI translates via `themes.names.<id>` when present (proper nouns like Nord or
 * Solarized keep their name in every language).
 */
export interface ThemeDef {
  id: string;
  label: string;
  /** Modes this theme ships. Single-mode themes pin `data-theme` to that mode
   * (the light/dark preference is kept but has no effect while active). */
  modes: ThemeMode[];
  swatch: Partial<Record<ThemeMode, ThemeSwatch>>;
  /** Hidden from the theme picker until unlocked (easter egg). */
  unlock?: "easteregg";
  variants?: ThemeVariantDef[];
  defaultVariant?: string;
}

/** LCARS collectible variants — one per recognised Star Trek line (see
 * services/startrekQuotes.ts; quote ids and variant ids match 1:1). */
export const LCARS_VARIANTS: ThemeVariantDef[] = [
  { id: "make-it-so", label: "Enterprise-D", accent: "#FF9C00" },
  { id: "live-long", label: "Vulcan", accent: "#D98E4A" },
  { id: "engage", label: "Warp", accent: "#7A9BFF" },
  { id: "resistance", label: "Borg", accent: "#4CE07A" },
  { id: "tea", label: "Earl Grey", accent: "#FFCC99" },
  { id: "fascinating", label: "Science", accent: "#5CD6D6" },
  { id: "space-frontier", label: "NCC-1701", accent: "#FFCC00" },
  { id: "hailing", label: "Subspace", accent: "#CC77CC" },
  { id: "beam-me-up", label: "Transporter", accent: "#9CC7FF" },
  { id: "darmok", label: "El-Adrel", accent: "#CC7A52" },
  { id: "qapla", label: "Qo'noS", accent: "#E05C5C" },
  { id: "four-lights", label: "Four Lights", accent: "#F2F2F2" },
  { id: "red-alert", label: "Red Alert", accent: "#FF4444" },
];

export const AVAILABLE_THEMES: ThemeDef[] = [
  {
    id: "petrol", label: "Petrol", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#ffffff", surface: "#eff5f4", text: "#1b2b29", accent: "#0f766e" },
      dark: { bg: "#0f1c1b", surface: "#152625", text: "#d7e4e2", accent: "#2dd4bf" },
    },
  },
  {
    id: "nord", label: "Nord", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#ECEFF4", surface: "#E5E9F0", text: "#2E3440", accent: "#5E81AC" },
      dark: { bg: "#2E3440", surface: "#3B4252", text: "#ECEFF4", accent: "#88C0D0" },
    },
  },
  {
    id: "solarized", label: "Solarized", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#FDF6E3", surface: "#EEE8D5", text: "#657B83", accent: "#268BD2" },
      dark: { bg: "#002B36", surface: "#073642", text: "#93A1A1", accent: "#268BD2" },
    },
  },
  {
    id: "gruvbox", label: "Gruvbox", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#FBF1C7", surface: "#EBDBB2", text: "#3C3836", accent: "#D65D0E" },
      dark: { bg: "#282828", surface: "#3C3836", text: "#EBDBB2", accent: "#FE8019" },
    },
  },
  {
    id: "catppuccin", label: "Catppuccin", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#EFF1F5", surface: "#E6E9EF", text: "#4C4F69", accent: "#8839EF" },
      dark: { bg: "#1E1E2E", surface: "#313244", text: "#CDD6F4", accent: "#CBA6F7" },
    },
  },
  {
    id: "paper", label: "Paper", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#FAFAF8", surface: "#F0F0EC", text: "#1A1A18", accent: "#33332F" },
      dark: { bg: "#171715", surface: "#222220", text: "#E8E6E0", accent: "#D6D4CC" },
    },
  },
  {
    id: "sepia", label: "Sepia", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#F7F0E3", surface: "#EFE5D2", text: "#43382A", accent: "#8B5E2F" },
      dark: { bg: "#241D14", surface: "#2E251A", text: "#E8DCC8", accent: "#C89454" },
    },
  },
  {
    id: "forest", label: "Forest", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#F4F7F2", surface: "#E8EFE5", text: "#22301F", accent: "#3F7A52" },
      dark: { bg: "#131A12", surface: "#1C261A", text: "#D8E4D3", accent: "#7FB08A" },
    },
  },
  {
    id: "midnight", label: "Midnight", modes: ["dark"],
    swatch: {
      dark: { bg: "#000000", surface: "#0D0D0D", text: "#E6E6E6", accent: "#2DD4BF" },
    },
  },
  {
    id: "high-contrast", label: "High Contrast", modes: ["light", "dark"],
    swatch: {
      light: { bg: "#FFFFFF", surface: "#F2F2F2", text: "#000000", accent: "#0033CC" },
      dark: { bg: "#000000", surface: "#111111", text: "#FFFFFF", accent: "#FFD500" },
    },
  },
  {
    id: "phosphor-green", label: "Phosphor Green", modes: ["dark"],
    swatch: {
      dark: { bg: "#030A04", surface: "#07120A", text: "#3BF07A", accent: "#5CFF9C" },
    },
  },
  {
    id: "phosphor-amber", label: "Phosphor Amber", modes: ["dark"],
    swatch: {
      dark: { bg: "#0A0500", surface: "#140B02", text: "#FFB000", accent: "#FFC53D" },
    },
  },
  {
    id: "lcars", label: "LCARS", modes: ["dark"], unlock: "easteregg",
    swatch: {
      dark: { bg: "#000000", surface: "#0A0A0F", text: "#EFDFC8", accent: "#FF9C00" },
    },
    variants: LCARS_VARIANTS,
    defaultVariant: "make-it-so",
  },
  {
    // Retro desktop homage; light only. Easter egg since 2026-07-06: hidden
    // until Scotty's "Hello computer" (Star Trek IV) is transmitted in the
    // hailing-frequencies dialog — deliberately the LAST picker card once
    // unlocked. "Windows" is a Microsoft trademark — attribution note in
    // docs/engineering/Theme_Platform.md.
    id: "win95", label: "Windows 95", modes: ["light"], unlock: "easteregg",
    swatch: {
      light: { bg: "#008080", surface: "#C0C0C0", text: "#000000", accent: "#000080" },
    },
  },
];

export const DEFAULT_THEME_NAME = "petrol";

export function getThemeDef(id: ThemeName): ThemeDef | undefined {
  return AVAILABLE_THEMES.find((t) => t.id === id);
}

/** True when the theme ships only one mode, so the light/dark toggle and the
 * mode preference have no effect while it is active. */
export function isModePinned(themeName: ThemeName): boolean {
  const def = getThemeDef(themeName);
  return !!def && def.modes.length === 1;
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolves the effective mode: single-mode themes pin it, otherwise the
 * preference (or the OS scheme for "system") decides. */
export function resolveThemeMode(pref: ThemePref, themeName: ThemeName): ThemeMode {
  const def = getThemeDef(themeName);
  if (def && def.modes.length === 1) return def.modes[0];
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

/** Back-compat resolver without pinning (kept for callers that only care about
 * the preference, e.g. previews of multi-mode themes). */
export function resolveTheme(pref: ThemePref): ThemeMode {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

/** Writes all three theme axes onto <html>. No-op without a DOM (unit tests). */
export function applyResolved(pref: ThemePref, name: ThemeName, variant?: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const themeName = name || DEFAULT_THEME_NAME;
  root.setAttribute("data-theme-name", themeName);
  root.setAttribute("data-theme", resolveThemeMode(pref, themeName));
  const def = getThemeDef(themeName);
  const v = variant ?? def?.defaultVariant;
  if (def?.variants?.length && v) root.setAttribute("data-theme-variant", v);
  else root.removeAttribute("data-theme-variant");
}

/** Sets `data-theme` on the document root so the CSS variables switch. Pinned
 * themes (single mode) keep their mode regardless of the preference. */
export function applyTheme(pref: ThemePref): void {
  const name = document.documentElement.getAttribute("data-theme-name") || DEFAULT_THEME_NAME;
  document.documentElement.setAttribute("data-theme", resolveThemeMode(pref, name));
}

/** Sets `data-theme-name` on the document root, selecting the bundled theme. */
export function applyThemeName(name: ThemeName): void {
  document.documentElement.setAttribute("data-theme-name", name || DEFAULT_THEME_NAME);
}


