/**
 * A curated catalog of the fonts a device is likely to have (feedback round
 * 2026-09-01, T7 / P12). The free-text field stays as the last resort; this
 * is the list in front of it, with a preview in the row and a note when a
 * font is NOT installed — the two things a text field cannot say.
 *
 * Why curated and not enumerated: the iOS WebView has no font-enumeration
 * API, and the desktop WebViews differ (queryLocalFonts is Chromium-only and
 * permission-gated). A short list of the families each platform ships,
 * checked one by one against the renderer, works everywhere the same way.
 */

export type FontPlatform = "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
export type FontKind = "serif" | "sans" | "mono";

export interface CatalogFont {
  /** What the row shows. */
  name: string;
  /** The `font-family` value; differs from the name for the generic aliases. */
  css: string;
  kind: FontKind;
  /** A generic alias the renderer always resolves (ui-serif, system-ui …). */
  generic?: boolean;
}

const f = (name: string, kind: FontKind, css = name, generic = false): CatalogFont => ({ name, css, kind, generic });

const APPLE_SHARED: CatalogFont[] = [
  f("New York", "serif", "ui-serif", true),
  f("Charter", "serif"),
  f("Georgia", "serif"),
  f("Palatino", "serif"),
  f("Iowan Old Style", "serif"),
  f("Baskerville", "serif"),
  f("Hoefler Text", "serif"),
  f("Times New Roman", "serif"),
  f("Avenir", "sans"),
  f("Avenir Next", "sans"),
  f("Helvetica Neue", "sans"),
  f("Gill Sans", "sans"),
  f("Optima", "sans"),
  f("Futura", "sans"),
  f("Verdana", "sans"),
  f("Trebuchet MS", "sans"),
  f("Menlo", "mono"),
  f("Courier New", "mono"),
  f("American Typewriter", "mono"),
];

export const FONT_CATALOG: Record<FontPlatform, readonly CatalogFont[]> = {
  ios: [f("San Francisco", "sans", "-apple-system", true), ...APPLE_SHARED],
  macos: [f("San Francisco", "sans", "-apple-system", true), f("SF Mono", "mono", "ui-monospace", true), ...APPLE_SHARED, f("Monaco", "mono")],
  windows: [
    f("Segoe UI", "sans"),
    f("Calibri", "sans"),
    f("Candara", "sans"),
    f("Corbel", "sans"),
    f("Bahnschrift", "sans"),
    f("Verdana", "sans"),
    f("Tahoma", "sans"),
    f("Trebuchet MS", "sans"),
    f("Arial", "sans"),
    f("Georgia", "serif"),
    f("Cambria", "serif"),
    f("Constantia", "serif"),
    f("Sitka Text", "serif"),
    f("Garamond", "serif"),
    f("Book Antiqua", "serif"),
    f("Palatino Linotype", "serif"),
    f("Times New Roman", "serif"),
    f("Consolas", "mono"),
    f("Cascadia Code", "mono"),
    f("Cascadia Mono", "mono"),
    f("Courier New", "mono"),
  ],
  android: [
    f("Roboto", "sans"),
    f("Noto Sans", "sans"),
    f("Noto Serif", "serif"),
    f("Roboto Serif", "serif"),
    f("Droid Sans Mono", "mono"),
    f("Roboto Mono", "mono"),
    f("Noto Sans Mono", "mono"),
    f("Sans-serif (system)", "sans", "sans-serif", true),
    f("Serif (system)", "serif", "serif", true),
    f("Monospace (system)", "mono", "monospace", true),
  ],
  linux: [
    f("Inter", "sans"),
    f("Cantarell", "sans"),
    f("Ubuntu", "sans"),
    f("Fira Sans", "sans"),
    f("Noto Sans", "sans"),
    f("DejaVu Sans", "sans"),
    f("Liberation Sans", "sans"),
    f("Noto Serif", "serif"),
    f("DejaVu Serif", "serif"),
    f("Liberation Serif", "serif"),
    f("Source Serif 4", "serif"),
    f("Fira Code", "mono"),
    f("Source Code Pro", "mono"),
    f("JetBrains Mono", "mono"),
    f("Noto Sans Mono", "mono"),
    f("DejaVu Sans Mono", "mono"),
    f("Liberation Mono", "mono"),
  ],
  unknown: [
    f("Georgia", "serif"),
    f("Times New Roman", "serif"),
    f("Arial", "sans"),
    f("Verdana", "sans"),
    f("Courier New", "mono"),
  ],
};

/** Which catalog this device gets, from what the renderer says about itself. */
export function detectFontPlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === "undefined" ? undefined : navigator): FontPlatform {
  if (!nav) return "unknown";
  const s = `${nav.platform ?? ""} ${nav.userAgent ?? ""}`;
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  // An iPad with a desktop user agent says "MacIntel" and carries touch — the
  // WebView is the same WebKit either way, so the Apple catalog is right.
  if (/Mac/i.test(s)) return "macos";
  if (/Win/i.test(s)) return "windows";
  if (/Linux|X11|CrOS/i.test(s)) return "linux";
  return "unknown";
}

/** Measures the width of a probe string in a font stack — injectable for tests. */
/**
 * The first family of a CSS font stack, unquoted — what a field shows as the
 * name of "the theme's font" ("Inter" from `Inter, Avenir, Helvetica, …`).
 */
export function firstFontFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "").trim();
}

export type FontMeasure = (fontFamily: string) => number;

const PROBE = "mmmmmmmmmmlliWWQ@あ";

/** The renderer's own measurement, via a canvas. Null where there is none (jsdom). */
export function canvasFontMeasure(doc: Document | undefined = typeof document === "undefined" ? undefined : document): FontMeasure | null {
  if (!doc) return null;
  try {
    const canvas = doc.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return (fontFamily) => {
      ctx.font = `32px ${fontFamily}`;
      return ctx.measureText(PROBE).width;
    };
  } catch {
    return null;
  }
}

/**
 * Whether a family is installed: the classic width comparison. Text set in
 * `"<name>", <fallback>` renders in the fallback when the name is unknown —
 * so if the width differs from the bare fallback for EITHER of two very
 * different fallbacks, the name resolved to a real font. Generic aliases are
 * always available; without a measurer the answer is "unknown" (null), and
 * the row then simply carries no verdict.
 */
export function isFontInstalled(font: CatalogFont, measure: FontMeasure | null): boolean | null {
  if (font.generic) return true;
  if (!measure) return null;
  const name = `"${font.css.replace(/"/g, "")}"`;
  const mono = measure("monospace");
  const serif = measure("serif");
  const inMono = measure(`${name}, monospace`);
  const inSerif = measure(`${name}, serif`);
  return inMono !== mono || inSerif !== serif;
}
