import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";
import { getStoredCustomTheme, setStoredCustomTheme } from "./theme";

/**
 * Font preferences (GitHub issues #5 and #82): the content font SIZE (editor +
 * read view, 12–24 px) and the three font SLOTS — interface, content, code —
 * as one card under Settings › Appearance. Whole-UI scaling stays the shell
 * zoom's job (services/uiZoom.ts, desktop-only).
 *
 * The model lives in @plainva/ui (`appFonts.ts`): the phone offers the same
 * three slots with the same meaning. This file is only the desktop's store
 * binding (Tauri store, global setting, device-local — installed fonts differ
 * per device, so the choice does not travel in the settings profile).
 *
 * The content slot keeps its historical store keys (`contentFontFamily`,
 * `contentFontCustom`), so a 0.8.0 install keeps its content font.
 */

export {
  applyContentFontFamily,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  FONT_FAMILY_STACKS,
  isContentFontFamily,
  MAX_CONTENT_FONT_SIZE,
  MIN_CONTENT_FONT_SIZE,
  resolveFontFamilyValue,
  sanitizeFontName,
  type AppFonts,
  type ContentFontFamily,
  type FontChoice,
  type FontSlot,
} from "@plainva/ui";
import {
  applyAppFonts,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  defaultAppFonts,
  FONT_SLOTS,
  migrateCustomThemeFont,
  parseFontChoice,
  sanitizeFontName,
  type AppFonts,
  type FontSlot,
} from "@plainva/ui";

export function applyContentFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--content-font-size", `${clampContentFontSize(size)}px`);
}

export interface AppFontSettings {
  size: number;
  fonts: AppFonts;
}

/** Store keys per slot: [family, custom name]. */
const SLOT_KEYS: Record<FontSlot, [string, string]> = {
  ui: ["uiFontFamily", "uiFontCustom"],
  content: ["contentFontFamily", "contentFontCustom"],
  code: ["codeFontFamily", "codeFontCustom"],
};

export function defaultAppFontSettings(): AppFontSettings {
  return { size: DEFAULT_CONTENT_FONT_SIZE, fonts: defaultAppFonts() };
}

export async function getStoredAppFonts(): Promise<AppFontSettings> {
  try {
    const store = await getSettingsStore();
    const size = clampContentFontSize(await store.get<number>("contentFontSize"));
    const fonts = defaultAppFonts();
    for (const slot of FONT_SLOTS) {
      const [familyKey, customKey] = SLOT_KEYS[slot];
      fonts[slot] = parseFontChoice(await store.get<string>(familyKey), await store.get<string>(customKey));
    }
    return { size, fonts };
  } catch {
    return defaultAppFontSettings();
  }
}

export async function setStoredAppFonts(settings: AppFontSettings): Promise<void> {
  // Apply to the DOM FIRST so the switch is felt immediately — the persist must
  // never gate the look. Previously the apply ran after the awaited store.save()
  // and a slow/failed write made the switcher appear to "do nothing".
  applyContentFontSize(settings.size);
  applyAppFonts(settings.fonts);
  try {
    const store = await getSettingsStore();
    await store.set("contentFontSize", clampContentFontSize(settings.size));
    for (const slot of FONT_SLOTS) {
      const [familyKey, customKey] = SLOT_KEYS[slot];
      await store.set(familyKey, settings.fonts[slot].family);
      await store.set(customKey, sanitizeFontName(settings.fonts[slot].customName));
    }
    await store.save();
    notifyAppearanceChanged();
  } catch {
    // Persist failed — the live look is already applied; swallow so the caller's
    // fire-and-forget `void setStoredAppFonts(...)` never rejects unhandled.
  }
}

/**
 * One-time move of the interface font out of "My design" (plan Issue-Durchsicht
 * 2026-09-06, E2): a stored custom theme that still names a `fontUi` seeds the
 * interface slot — only while that slot has never been stored — and the spec's
 * field is cleared so it cannot seed twice. Returns true when something moved.
 */
export async function migrateInterfaceFontFromCustomTheme(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    const uiStored = (await store.get<string>(SLOT_KEYS.ui[0])) != null;
    const spec = await getStoredCustomTheme();
    const current = await getStoredAppFonts();
    const moved = migrateCustomThemeFont(current.fonts, spec.fontUi, uiStored);
    if (!moved) {
      if (spec.fontUi && uiStored) await setStoredCustomTheme({ ...spec, fontUi: "" });
      return false;
    }
    await setStoredAppFonts({ ...current, fonts: moved });
    await setStoredCustomTheme({ ...spec, fontUi: "" });
    return true;
  } catch {
    return false;
  }
}

/** Applies defaults immediately (no flash), then the stored values. */
export function initAppFonts(): void {
  getStoredAppFonts()
    .then((s) => {
      applyContentFontSize(s.size);
      applyAppFonts(s.fonts);
    })
    .then(() => migrateInterfaceFontFromCustomTheme())
    .catch(() => {});
}
