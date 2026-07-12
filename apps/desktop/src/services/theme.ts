import { getSettingsStore } from "./settingsStore";
import { applyResolved } from "@plainva/ui";

// The theme registry and resolvers live in @plainva/ui (mobile M3E package D2)
// so both shells share ONE catalog. This module keeps the desktop persistence
// (settings store, unlocks, easter-egg activation) and re-exports the registry
// so existing desktop imports keep working unchanged.
export {
  applyResolved,
  applyTheme,
  applyThemeName,
  AVAILABLE_THEMES,
  DEFAULT_THEME_NAME,
  getThemeDef,
  isModePinned,
  LCARS_VARIANTS,
  resolveTheme,
  resolveThemeMode,
} from "@plainva/ui";
export type {
  ThemeDef,
  ThemeMode,
  ThemeName,
  ThemePref,
  ThemeSwatch,
  ThemeVariantDef,
} from "@plainva/ui";
import {
  AVAILABLE_THEMES,
  DEFAULT_THEME_NAME,
  getThemeDef,
  isModePinned,
  type ThemeDef,
  type ThemeMode,
  type ThemeName,
  type ThemePref,
} from "@plainva/ui";

/** Re-reads the stored preferences and applies everything (mode pinning and
 * the theme's active variant included). */
export async function applyStoredTheme(): Promise<void> {
  const [pref, name, variants] = await Promise.all([
    getStoredThemePref(),
    getStoredThemeName(),
    getStoredThemeVariants(),
  ]);
  applyResolved(pref, name, variants[name]);
}

export async function getStoredThemePref(): Promise<ThemePref> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<ThemePref>("theme");
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export async function setStoredThemePref(pref: ThemePref): Promise<void> {
  const store = await getSettingsStore();
  await store.set("theme", pref);
  await store.save();
  await applyStoredTheme();
}

export async function getStoredThemeName(): Promise<ThemeName> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<string>("themeName");
    return typeof v === "string" && v ? v : DEFAULT_THEME_NAME;
  } catch {
    return DEFAULT_THEME_NAME;
  }
}

export async function setStoredThemeName(name: ThemeName): Promise<void> {
  const store = await getSettingsStore();
  await store.set("themeName", name);
  await store.save();
  await applyStoredTheme();
}

/** Active variant per theme, e.g. { lcars: "engage" }. */
export async function getStoredThemeVariants(): Promise<Record<string, string>> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<Record<string, string>>("themeVariants");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export async function setStoredThemeVariant(themeId: string, variantId: string): Promise<void> {
  const store = await getSettingsStore();
  const current = (await store.get<Record<string, string>>("themeVariants")) ?? {};
  await store.set("themeVariants", { ...current, [themeId]: variantId });
  await store.save();
  await applyStoredTheme();
}

/** Ids of easter-egg themes the user has discovered. */
export async function getUnlockedThemes(): Promise<string[]> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<string[]>("unlockedThemes");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function addUnlockedTheme(id: string): Promise<void> {
  const store = await getSettingsStore();
  const current = (await store.get<string[]>("unlockedThemes")) ?? [];
  if (!current.includes(id)) {
    await store.set("unlockedThemes", [...current, id]);
    await store.save();
  }
}

/** Collected variant ids per theme, e.g. { lcars: ["make-it-so", "qapla"] }. */
export async function getUnlockedVariants(): Promise<Record<string, string[]>> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<Record<string, string[]>>("unlockedThemeVariants");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Adds a collected variant; returns the theme's new collection. */
export async function addUnlockedVariant(themeId: string, variantId: string): Promise<string[]> {
  const store = await getSettingsStore();
  const all = ((await store.get<Record<string, string[]>>("unlockedThemeVariants")) ?? {}) as Record<string, string[]>;
  const list = Array.isArray(all[themeId]) ? all[themeId] : [];
  const next = list.includes(variantId) ? list : [...list, variantId];
  await store.set("unlockedThemeVariants", { ...all, [themeId]: next });
  await store.save();
  return next;
}

/** Filters the registry to what the theme picker may show. */
export function visibleThemes(unlocked: string[]): ThemeDef[] {
  return AVAILABLE_THEMES.filter((t) => !t.unlock || unlocked.includes(t.id));
}

/** Activates an easter-egg theme (remembering the previous theme) with the
 * given variant, unlocking both. */
export async function activateEasterEggTheme(themeId: string, variantId: string): Promise<void> {
  const store = await getSettingsStore();
  const current = await getStoredThemeName();
  if (current !== themeId) {
    await store.set(`themeBefore_${themeId}`, current);
    await store.save();
  }
  await addUnlockedTheme(themeId);
  await addUnlockedVariant(themeId, variantId);
  await setStoredThemeVariant(themeId, variantId);
  await setStoredThemeName(themeId);
}

/** Activates a variant-less easter-egg theme (win95): remembers the previous
 * theme and unlocks + switches — no variant machinery involved. */
export async function activateEasterEggThemeNoVariant(themeId: string): Promise<void> {
  const store = await getSettingsStore();
  const current = await getStoredThemeName();
  if (current !== themeId) {
    await store.set(`themeBefore_${themeId}`, current);
    await store.save();
  }
  await addUnlockedTheme(themeId);
  await setStoredThemeName(themeId);
}

/** Switches back from an easter-egg theme to whatever was active before it. */
export async function deactivateEasterEggTheme(themeId: string): Promise<void> {
  let previous = DEFAULT_THEME_NAME;
  try {
    const store = await getSettingsStore();
    const v = await store.get<string>(`themeBefore_${themeId}`);
    if (typeof v === "string" && v && v !== themeId && getThemeDef(v)) previous = v;
  } catch {
    /* fall back to default */
  }
  await setStoredThemeName(previous);
}

/**
 * Quick toggle for the title bar: flips between explicit light and dark and
 * persists the choice. (The "system" option stays available in Settings.)
 * No-op while a single-mode theme pins the mode — the title bar disables the
 * button in that case.
 */
export async function toggleLightDark(): Promise<ThemeMode> {
  const current = (document.documentElement.getAttribute("data-theme") as ThemeMode | null) ?? "light";
  const name = document.documentElement.getAttribute("data-theme-name") || DEFAULT_THEME_NAME;
  if (isModePinned(name)) return current;
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  await setStoredThemePref(next);
  return next;
}

let systemListenerAttached = false;

/**
 * Applies the system theme + default theme name immediately (to avoid a flash),
 * then refines from the stored preferences and — while the mode preference is
 * "system" — keeps following the OS color scheme.
 */
export function initTheme(): void {
  applyResolved("system", DEFAULT_THEME_NAME);
  applyStoredTheme()
    .then(async () => {
      // Grandfathering: a gated theme that is already ACTIVE counts as
      // discovered (win95 shipped ungated on 2026-07-05 and became an easter
      // egg on 2026-07-06 — existing users keep their picker card).
      try {
        const name = await getStoredThemeName();
        if (getThemeDef(name)?.unlock) await addUnlockedTheme(name);
      } catch {
        /* ignore */
      }
      if (!systemListenerAttached && typeof window !== "undefined" && window.matchMedia) {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        mq.addEventListener?.("change", () => {
          applyStoredTheme().catch(() => {});
        });
        systemListenerAttached = true;
      }
    })
    .catch(() => {});
}
