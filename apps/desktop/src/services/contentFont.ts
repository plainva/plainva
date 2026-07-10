import { getSettingsStore } from "./settingsStore";

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

export const DEFAULT_CONTENT_FONT_SIZE = 16;
export const MIN_CONTENT_FONT_SIZE = 12;
export const MAX_CONTENT_FONT_SIZE = 24;

export type ContentFontFamily = "theme" | "serif" | "sans" | "mono" | "custom";

export const FONT_FAMILY_STACKS: Record<Exclude<ContentFontFamily, "theme" | "custom">, string> = {
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  sans: "Inter, Avenir, Helvetica, Arial, sans-serif",
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
};

export function isContentFontFamily(v: unknown): v is ContentFontFamily {
  return v === "theme" || v === "serif" || v === "sans" || v === "mono" || v === "custom";
}

export function clampContentFontSize(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_CONTENT_FONT_SIZE;
  return Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, n));
}

/** CSS string delimiters/escapes that must never survive sanitizing. */
const FORBIDDEN_FONT_CHARS = ';{}"\'`\\';

/**
 * Custom font names stay Unicode (international families are fine) — only
 * control characters and CSS string delimiters/escapes are stripped; the
 * value is then wrapped in double quotes, so nothing can escape the
 * declaration. Built char-by-char to avoid control-char regex literals.
 */
export function sanitizeFontName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (ch.charCodeAt(0) < 32) continue;
    if (FORBIDDEN_FONT_CHARS.includes(ch)) continue;
    out += ch;
  }
  return out.trim();
}

/** CSS.supports guard — jsdom has no CSS object; treat that as "supported". */
function fontFamilySupported(value: string): boolean {
  try {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;
    return CSS.supports("font-family", value);
  } catch {
    return true;
  }
}

/** Resolves the --font-content override for a choice; null = keep the theme's. */
export function resolveFontFamilyValue(family: ContentFontFamily, customName: string): string | null {
  if (family === "theme") return null;
  if (family === "custom") {
    const name = sanitizeFontName(customName);
    if (!name) return null;
    const value = `"${name}", ${FONT_FAMILY_STACKS.sans}`;
    return fontFamilySupported(value) ? value : null;
  }
  return FONT_FAMILY_STACKS[family];
}

export function applyContentFontSize(size: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--content-font-size", `${clampContentFontSize(size)}px`);
}

export function applyContentFontFamily(family: ContentFontFamily, customName: string): void {
  if (typeof document === "undefined") return;
  const value = resolveFontFamilyValue(family, customName);
  if (value === null) document.documentElement.style.removeProperty("--font-content");
  else document.documentElement.style.setProperty("--font-content", value);
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
  const store = await getSettingsStore();
  await store.set("contentFontSize", clampContentFontSize(settings.size));
  await store.set("contentFontFamily", settings.family);
  await store.set("contentFontCustom", sanitizeFontName(settings.customName));
  await store.save();
  applyContentFontSize(settings.size);
  applyContentFontFamily(settings.family, settings.customName);
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
