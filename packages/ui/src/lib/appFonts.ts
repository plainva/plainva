/**
 * The three font slots of the app — interface, content, code — as ONE model
 * for both shells (issue #82, plan Issue-Durchsicht 2026-09-06, P2/E2).
 *
 * History: the content font (editor + reading view) has been a setting since
 * v0.2.0 (issue #5) and moved here from the desktop in S39 so the phone could
 * offer the same choice with the same meaning. The interface font existed only
 * inside "My design" (the custom theme), and the code font could not be set
 * at all — two places said "monospace" as a literal and ignored `--font-mono`.
 *
 * Now every slot is the same shape: a family choice ("theme" = the theme keeps
 * its own font, three generic presets, or a custom name from the catalogue or
 * typed in), resolved to a CSS value and written onto `<html>` as the token
 * that slot owns. The theme stays the default; a choice is an override on top
 * of it and is removed again by choosing "theme" — so LCARS keeps Antonio
 * until somebody asks for something else.
 *
 * The settings are DEVICE-LOCAL by design: the fonts installed on a laptop are
 * not the ones on a phone, and a synced "Cascadia Code" on a device without it
 * would silently fall back to the stack. Each shell persists its own copy.
 */

export type FontSlot = "ui" | "content" | "code";
export const FONT_SLOTS: readonly FontSlot[] = ["ui", "content", "code"];

/** One family choice: a preset, the theme's own, or a name of the user's. */
export type ContentFontFamily = "theme" | "serif" | "sans" | "mono" | "custom";

export interface FontChoice {
  family: ContentFontFamily;
  /** Only meaningful while `family` is "custom". */
  customName: string;
}

export interface AppFonts {
  ui: FontChoice;
  content: FontChoice;
  code: FontChoice;
}

export const THEME_FONT: Readonly<FontChoice> = Object.freeze({ family: "theme", customName: "" });

export function defaultAppFonts(): AppFonts {
  return { ui: { ...THEME_FONT }, content: { ...THEME_FONT }, code: { ...THEME_FONT } };
}

/** The tokens each slot writes. `--font-family` is the legacy alias of `--font-ui`. */
export const FONT_SLOT_TOKENS: Record<FontSlot, readonly string[]> = {
  ui: ["--font-ui", "--font-family"],
  content: ["--font-content"],
  code: ["--font-mono"],
};

/** The generic stacks the presets resolve to — the same on every platform. */
export const FONT_FAMILY_STACKS: Record<Exclude<ContentFontFamily, "theme" | "custom">, string> = {
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  sans: "Inter, Avenir, Helvetica, Arial, sans-serif",
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
};

export function isContentFontFamily(v: unknown): v is ContentFontFamily {
  return v === "theme" || v === "serif" || v === "sans" || v === "mono" || v === "custom";
}

/**
 * Family keywords the renderer resolves itself. Quoted, "ui-serif" would be a
 * font NAME nobody has; bare, it is New York on Apple and the serif face of
 * the platform elsewhere — which is what the catalog rows for them promise.
 */
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "-apple-system", "cursive", "fantasy"]);

/** CSS string delimiters/escapes that must never survive sanitizing. */
const FORBIDDEN_FONT_CHARS = ";{}\"'`\\";

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

/** A stored pair of unknown shape → a choice; anything odd is "theme". */
export function parseFontChoice(family: unknown, customName: unknown): FontChoice {
  const fam = isContentFontFamily(family) ? family : "theme";
  const name = typeof customName === "string" ? sanitizeFontName(customName) : "";
  return { family: fam, customName: fam === "custom" ? name : "" };
}

/** The label-worthy name of a choice for a row: the custom name, or null for
 * a preset/theme (the caller has the words for those). */
export function fontChoiceName(choice: FontChoice): string | null {
  return choice.family === "custom" && choice.customName ? choice.customName : null;
}

/**
 * Resolves a choice to the CSS value for its slot; null = keep the theme's.
 * A custom name falls back to the slot's natural stack — sans for interface
 * and content, mono for code — so a missing font still reads as intended.
 */
export function resolveFontChoiceValue(slot: FontSlot, choice: FontChoice): string | null {
  if (choice.family === "theme") return null;
  if (choice.family === "custom") {
    const name = sanitizeFontName(choice.customName);
    if (!name) return null;
    const family = GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`;
    const fallback = slot === "code" ? FONT_FAMILY_STACKS.mono : FONT_FAMILY_STACKS.sans;
    const value = `${family}, ${fallback}`;
    return fontFamilySupported(value) ? value : null;
  }
  return FONT_FAMILY_STACKS[choice.family];
}

/** Writes (or removes) the slot's tokens on `<html>`. No-op without a DOM. */
export function applyAppFont(slot: FontSlot, choice: FontChoice): void {
  if (typeof document === "undefined") return;
  const value = resolveFontChoiceValue(slot, choice);
  const style = document.documentElement.style;
  for (const token of FONT_SLOT_TOKENS[slot]) {
    if (value === null) style.removeProperty(token);
    else style.setProperty(token, value);
  }
}

export function applyAppFonts(fonts: AppFonts): void {
  for (const slot of FONT_SLOTS) applyAppFont(slot, fonts[slot]);
}

/**
 * The one-time move of the interface font out of "My design" (E2): until the
 * plan Issue-Durchsicht 2026-09-06 the custom theme carried a `fontUi`, which
 * wrote the same `--font-ui` this model writes. A spec that still names one is
 * read once into the interface slot — only when the slot has never been set,
 * so a later choice of the user is not overwritten by a stale spec — and the
 * caller clears the spec's field. Returns the migrated fonts, or null when
 * there was nothing to move.
 */
export function migrateCustomThemeFont(fonts: AppFonts, specFontUi: string | undefined, uiSlotWasStored: boolean): AppFonts | null {
  const name = typeof specFontUi === "string" ? sanitizeFontName(specFontUi) : "";
  if (!name || uiSlotWasStored) return null;
  return { ...fonts, ui: { family: "custom", customName: name } };
}
