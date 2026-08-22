import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";

/**
 * Content font preferences (GitHub issue #5, a11y): size and family of the
 * DOCUMENT content (editor + read view) — chrome text is untouched; whole-UI
 * scaling is the shell zoom's job (services/uiZoom.ts, desktop-only).
 *
 * Size drives --content-font-size on <html>; family overrides --font-content
 * (the theme keeps ownership while the choice is "theme"). Persistence
 * mirrors services/density.ts (Tauri store, global setting). The tokens live
 * in @plainva/ui, so the mobile shell can reuse the same mechanism with its
 * own settings screen.
 */

// Size limits + clamp live in @plainva/ui (M3E package D6) — one 12–24 px
// contract for both shells; re-exported so desktop imports stay unchanged.
// S39 moved the FAMILY decisions there too (stacks, custom-name sanitizing,
// the --font-content resolver), so the phone offers the same choice with the
// same meaning. This file keeps only the desktop's store binding.
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
  type ContentFontFamily,
} from "@plainva/ui";
import {
  applyContentFontFamily,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  isContentFontFamily,
  sanitizeFontName,
  type ContentFontFamily,
} from "@plainva/ui";

export function applyContentFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--content-font-size", `${clampContentFontSize(size)}px`);
}

export interface ContentFontSettings {
  size: number;
  family: ContentFontFamily;
  customName: string;
}

export async function getStoredContentFont(): Promise<ContentFontSettings> {
  try {
    const store = await getSettingsStore();
    const size = clampContentFontSize(await store.get<number>("contentFontSize"));
    const familyRaw = await store.get<string>("contentFontFamily");
    const family = isContentFontFamily(familyRaw) ? familyRaw : "theme";
    const customName = (await store.get<string>("contentFontCustom")) ?? "";
    return { size, family, customName };
  } catch {
    return { size: DEFAULT_CONTENT_FONT_SIZE, family: "theme", customName: "" };
  }
}

export async function setStoredContentFont(settings: ContentFontSettings): Promise<void> {
  // Apply to the DOM FIRST so the switch is felt immediately — the persist must
  // never gate the look. Previously the apply ran after the awaited store.save()
  // and a slow/failed write made the switcher appear to "do nothing".
  applyContentFontSize(settings.size);
  applyContentFontFamily(settings.family, settings.customName);
  try {
    const store = await getSettingsStore();
    await store.set("contentFontSize", clampContentFontSize(settings.size));
    await store.set("contentFontFamily", settings.family);
    await store.set("contentFontCustom", sanitizeFontName(settings.customName));
    await store.save();
    notifyAppearanceChanged();
  } catch {
    // Persist failed — the live look is already applied; swallow so the caller's
    // fire-and-forget `void setStoredContentFont(...)` never rejects unhandled.
  }
}

/** Applies defaults immediately (no flash), then the stored values. */
export function initContentFont(): void {
  getStoredContentFont()
    .then((s) => {
      applyContentFontSize(s.size);
      applyContentFontFamily(s.family, s.customName);
    })
    .catch(() => {});
}
