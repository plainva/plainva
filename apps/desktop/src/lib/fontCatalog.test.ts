import { describe, expect, it } from "vitest";
import { FONT_CATALOG, detectFontPlatform, isFontInstalled, type CatalogFont, type FontPlatform } from "@plainva/ui";

/**
 * The curated font catalog behind the picker (P12, T7). What is pinned: each
 * platform's list is non-empty and free of duplicates, the platform comes
 * from the renderer's own description, and the "installed?" verdict follows
 * the width comparison — including the two cases a naive check gets wrong.
 */
describe("FONT_CATALOG", () => {
  it("offers every platform a list without duplicate names or css values", () => {
    for (const platform of Object.keys(FONT_CATALOG) as FontPlatform[]) {
      const list = FONT_CATALOG[platform];
      expect(list.length, platform).toBeGreaterThan(4);
      expect(new Set(list.map((x) => x.name)).size, platform).toBe(list.length);
      expect(new Set(list.map((x) => x.css)).size, platform).toBe(list.length);
      for (const x of list) expect(["serif", "sans", "mono"]).toContain(x.kind);
    }
  });

  it("keeps the fonts Igor named on the iOS list", () => {
    const names = FONT_CATALOG.ios.map((x) => x.name);
    for (const n of ["Avenir Next", "Georgia", "Palatino", "Charter", "New York", "Helvetica Neue", "Menlo"]) {
      expect(names).toContain(n);
    }
  });
});

describe("detectFontPlatform", () => {
  it("reads the platform from what the renderer says", () => {
    expect(detectFontPlatform({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe("ios");
    expect(detectFontPlatform({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toBe("android");
    expect(detectFontPlatform({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" })).toBe("macos");
    expect(detectFontPlatform({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe("windows");
    expect(detectFontPlatform({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
    expect(detectFontPlatform({})).toBe("unknown");
  });
});

describe("isFontInstalled", () => {
  const georgia: CatalogFont = { name: "Georgia", css: "Georgia", kind: "serif" };
  const generic: CatalogFont = { name: "New York", css: "ui-serif", kind: "serif", generic: true };
  // A measurer that knows exactly one real font: widths change only when
  // "Known" is asked for; every other name falls back to the generic.
  const measure = (fontFamily: string) => {
    const known = fontFamily.startsWith('"Known"');
    const fallback = fontFamily.endsWith("monospace") ? 100 : 80;
    return known ? fallback + 7 : fallback;
  };

  it("says yes for an installed family and no for an unknown one", () => {
    expect(isFontInstalled({ name: "Known", css: "Known", kind: "sans" }, measure)).toBe(true);
    expect(isFontInstalled(georgia, measure)).toBe(false);
  });

  it("treats generic aliases as always available and has no verdict without a measurer", () => {
    expect(isFontInstalled(generic, measure)).toBe(true);
    expect(isFontInstalled(georgia, null)).toBe(null);
    expect(isFontInstalled(generic, null)).toBe(true);
  });

  it("catches a font whose metrics happen to match ONE fallback", () => {
    // "Twin" is installed but as wide as the serif fallback; the monospace
    // comparison still tells it apart — one fallback alone would miss it.
    const twin = (fontFamily: string) => {
      if (fontFamily.startsWith('"Twin"')) return 80;
      return fontFamily.endsWith("monospace") ? 100 : 80;
    };
    expect(isFontInstalled({ name: "Twin", css: "Twin", kind: "serif" }, twin)).toBe(true);
  });
});
