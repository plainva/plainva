import {
  applyResolved,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  DEFAULT_THEME_NAME,
  getPlatformServices,
  getThemeDef,
} from "@plainva/ui";
import { changeAppLanguage } from "@plainva/ui/i18n";

/**
 * Mobile app settings (P1): tiny synchronous module cache over the platform
 * ISettingsStore (desktop initDefaultViewMode pattern — screens need the
 * values without awaiting). initMobileSettings() runs before first render.
 */

export type ThemeMode = "system" | "light" | "dark";
export type DefaultView = "read" | "edit";
export type MotionPref = "system" | "on" | "off";

interface MobileSettings {
  themeMode: ThemeMode;
  /** Bundled theme id from the shared registry (package D3); single-mode
   * themes pin `data-theme` regardless of `themeMode`. */
  themeName: string;
  defaultView: DefaultView;
  dailyFolder: string;
  /** ＋-capture target when no folder is open (R3.6). */
  inboxFolder: string;
  /** Where "insert template" / "new from template" look for .md templates
   * (R3.4; same default as the desktop's per-vault setting). */
  templateFolder: string;
  /** Empty = follow the system language. */
  language: string;
  /** First-start onboarding shown and answered. */
  onboarded: boolean;
  /** Bottom-bar screens (R2.2), sanitized by navigation.sanitizeTabSlots. */
  tabSlots: string[];
  /** Discovered easter-egg theme ids (D5; same semantics as the desktop). */
  unlockedThemes: string[];
  /** Collected LCARS palette variant ids (D5). */
  unlockedThemeVariants: string[];
  /** Theme active before an easter-egg theme took over (for the off toggle). */
  themeBefore: string;
  /** Active variant per theme, e.g. { lcars: "engage" }. */
  themeVariants: Record<string, string>;
  /** Note content font size in px, 12–24 (D6; shared limits, issue #5). */
  contentFontSize: number;
  /** Chrome motion: follow the OS, force on (OS says reduce), or force off. */
  motion: MotionPref;
  /** Snapshot retention (package G, global — the desktop keeps it per vault):
   * min seconds between snapshots (0 = every write), max per file, max age
   * in days (0 = unlimited). Applied to the active vault via updatePolicy. */
  backupIntervalSeconds: number;
  backupMaxPerFile: number;
  backupMaxAgeDays: number;
  /** Template file name (inside templateFolder) seeding new daily notes; empty = plain skeleton. */
  dailyTemplate: string;
}

const KEY = "mobile-settings";

const DEFAULTS: MobileSettings = {
  themeMode: "system",
  themeName: DEFAULT_THEME_NAME,
  defaultView: "read",
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  templateFolder: "Templates",
  language: "",
  onboarded: false,
  tabSlots: ["notes", "today", "tags", "bookmarks"],
  unlockedThemes: [],
  unlockedThemeVariants: [],
  themeVariants: {},
  themeBefore: "",
  contentFontSize: DEFAULT_CONTENT_FONT_SIZE,
  motion: "system",
  backupIntervalSeconds: 120,
  backupMaxPerFile: 100,
  backupMaxAgeDays: 90,
  dailyTemplate: "",
};

let cache: MobileSettings = { ...DEFAULTS };
let media: MediaQueryList | null = null;

function applyTheme(): void {
  // Shared applier (D3): writes data-theme-name AND the resolved data-theme —
  // single-mode themes (Midnight, LCARS, …) pin their mode; themes with a
  // default variant get it applied. themeMode maps 1:1 onto ThemePref.
  const name = getThemeDef(cache.themeName) ? cache.themeName : DEFAULT_THEME_NAME;
  applyResolved(cache.themeMode, name, cache.themeVariants[name]);
  const root = document.documentElement;
  // D6: note content size (chrome text is untouched — desktop contract).
  root.style.setProperty("--content-font-size", `${clampContentFontSize(cache.contentFontSize)}px`);
  // D6: chrome motion — the shared tokens.css collapses on data-motion="off"
  // and skips the OS reduce-collapse on "on"; absent = follow the system.
  if (cache.motion === "system") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", cache.motion);
}

export async function initMobileSettings(): Promise<void> {
  media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (cache.themeMode === "system") applyTheme();
  });
  try {
    const store = await getPlatformServices().loadSettings();
    const saved = await store.get<Partial<MobileSettings>>(KEY);
    if (saved) cache = { ...DEFAULTS, ...saved };
  } catch {
    /* fresh install / plain web — defaults apply */
  }
  applyTheme();
  if (cache.language) await changeAppLanguage(cache.language).catch(() => {});
}

export function getMobileSettings(): MobileSettings {
  return cache;
}

export async function updateMobileSettings(patch: Partial<MobileSettings>): Promise<void> {
  cache = { ...cache, ...patch };
  applyTheme();
  if (patch.language !== undefined) {
    // Empty string = back to the system language.
    const target = patch.language || navigator.language;
    await changeAppLanguage(target).catch(() => {});
  }
  // The app shell re-reads tab slots (and other live settings) on this.
  window.dispatchEvent(new CustomEvent("m-settings-changed"));
  const store = await getPlatformServices().loadSettings();
  await store.set(KEY, cache);
  await store.save();
}
