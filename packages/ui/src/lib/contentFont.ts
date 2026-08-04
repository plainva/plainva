/**
 * Content font-size limits (shared contract, M3E package D6): the note
 * content's `--content-font-size` is user-adjustable on BOTH shells within the
 * same 12–24 px window (GitHub issue #5, a11y). Each shell binds its own store
 * (desktop: apps/desktop/src/services/contentFont.ts, mobile: mobileSettings).
 *
 * S39 moved the FAMILY here too. It had stayed on the desktop, so the phone
 * could not offer the setting without inventing its own stacks and its own
 * idea of a safe custom name — two answers to "what does serif mean" for a
 * value that travels between devices through the settings profile.
 */

export const DEFAULT_CONTENT_FONT_SIZE = 16;
export const MIN_CONTENT_FONT_SIZE = 12;
export const MAX_CONTENT_FONT_SIZE = 24;

export function clampContentFontSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CONTENT_FONT_SIZE;
  return Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, Math.round(n)));
}

export type ContentFontFamily = "theme" | "serif" | "sans" | "mono" | "custom";

/** `--font-content` is the token both shells' editor and read view already use;
 *  "theme" means: do not override it, the theme owns the font. */
export const FONT_FAMILY_STACKS: Record<Exclude<ContentFontFamily, "theme" | "custom">, string> = {
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  sans: "Inter, Avenir, Helvetica, Arial, sans-serif",
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
};

export function isContentFontFamily(v: unknown): v is ContentFontFamily {
  return v === "theme" || v === "serif" || v === "sans" || v === "mono" || v === "custom";
}

/** CSS string delimiters/escapes that must never survive sanitizing. */
const FORBIDDEN_FONT_CHARS = ';{}"\'`\\';

/**
 * Custom font names stay Unicode (international families are fine) — only
 * control characters and CSS string delimiters/escapes are stripped; the value
 * is then wrapped in double quotes, so nothing can escape the declaration.
 * Built char-by-char to avoid control-char regex literals.
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

export function applyContentFontFamily(family: ContentFontFamily, customName: string): void {
  if (typeof document === "undefined") return;
  const value = resolveFontFamilyValue(family, customName);
  if (value === null) document.documentElement.style.removeProperty("--font-content");
  else document.documentElement.style.setProperty("--font-content", value);
}
