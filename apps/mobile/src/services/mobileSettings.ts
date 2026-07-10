import { getPlatformServices } from "@plainva/ui";
import { changeAppLanguage } from "@plainva/ui/i18n";

/**
 * Mobile app settings (P1): tiny synchronous module cache over the platform
 * ISettingsStore (desktop initDefaultViewMode pattern — screens need the
 * values without awaiting). initMobileSettings() runs before first render.
 */

export type ThemeMode = "system" | "light" | "dark";
export type DefaultView = "read" | "edit";

interface MobileSettings {
  themeMode: ThemeMode;
  defaultView: DefaultView;
  dailyFolder: string;
  /** Empty = follow the system language. */
  language: string;
  /** First-start onboarding shown and answered. */
  onboarded: boolean;
}

const KEY = "mobile-settings";

const DEFAULTS: MobileSettings = {
  themeMode: "system",
  defaultView: "read",
  dailyFolder: "Daily",
  language: "",
  onboarded: false,
};

let cache: MobileSettings = { ...DEFAULTS };
let media: MediaQueryList | null = null;

function applyTheme(): void {
  const dark =
    cache.themeMode === "dark" ||
    (cache.themeMode === "system" && !!media?.matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
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
  const store = await getPlatformServices().loadSettings();
  await store.set(KEY, cache);
  await store.save();
}
