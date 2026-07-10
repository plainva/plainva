// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeValues: Record<string, unknown> = {};
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => storeValues[k] as T | undefined,
    set: async (k: string, v: unknown) => {
      storeValues[k] = v;
    },
    save: async () => {},
  }),
}));

import {
  applyContentFontFamily,
  applyContentFontSize,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  getStoredContentFont,
  resolveFontFamilyValue,
  sanitizeFontName,
  setStoredContentFont,
} from "./contentFont";
import { clampUiZoom, DEFAULT_UI_ZOOM } from "./uiZoom";

describe("contentFont", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
    document.documentElement.style.removeProperty("--content-font-size");
    document.documentElement.style.removeProperty("--font-content");
  });

  it("clamps the size to 12–24 and defaults non-numbers", () => {
    expect(clampContentFontSize(16)).toBe(16);
    expect(clampContentFontSize(4)).toBe(12);
    expect(clampContentFontSize(99)).toBe(24);
    expect(clampContentFontSize("x")).toBe(DEFAULT_CONTENT_FONT_SIZE);
    expect(clampContentFontSize(Number.NaN)).toBe(DEFAULT_CONTENT_FONT_SIZE);
  });

  it("keeps Unicode font names but strips control chars and CSS delimiters", () => {
    expect(sanitizeFontName("Segoe UI")).toBe("Segoe UI");
    expect(sanitizeFontName("Ubuntu Condensed 2")).toBe("Ubuntu Condensed 2");
    expect(sanitizeFontName("源ノ角ゴシック")).toBe("源ノ角ゴシック");
    expect(sanitizeFontName('Evil"; } body { background: red')).toBe("Evil  body  background: red");
    expect(sanitizeFontName('A"B\'C;D{E}F\\G')).toBe("ABCDEFG");
    expect(sanitizeFontName("Tab\tName")).toBe("TabName");
  });

  it("resolves presets, wraps custom names in quotes and honors the theme choice", () => {
    expect(resolveFontFamilyValue("theme", "")).toBeNull();
    expect(resolveFontFamilyValue("serif", "")).toContain("Georgia");
    expect(resolveFontFamilyValue("mono", "")).toContain("monospace");
    expect(resolveFontFamilyValue("custom", "My Font")).toMatch(/^"My Font", /);
    expect(resolveFontFamilyValue("custom", "   ")).toBeNull();
  });

  it("applies size and family onto <html> and removes the override for theme", () => {
    applyContentFontSize(18);
    expect(document.documentElement.style.getPropertyValue("--content-font-size")).toBe("18px");
    applyContentFontFamily("mono", "");
    expect(document.documentElement.style.getPropertyValue("--font-content")).toContain("monospace");
    applyContentFontFamily("theme", "");
    expect(document.documentElement.style.getPropertyValue("--font-content")).toBe("");
  });

  it("persists and restores settings through the store", async () => {
    await setStoredContentFont({ size: 30, family: "custom", customName: ' "Fira Sans" ' });
    expect(storeValues.contentFontSize).toBe(24);
    expect(storeValues.contentFontCustom).toBe("Fira Sans");
    const restored = await getStoredContentFont();
    expect(restored).toEqual({ size: 24, family: "custom", customName: "Fira Sans" });
  });
});

describe("uiZoom", () => {
  it("clamps to 80–150 and defaults non-numbers to 100", () => {
    expect(clampUiZoom(100)).toBe(100);
    expect(clampUiZoom(10)).toBe(80);
    expect(clampUiZoom(400)).toBe(150);
    expect(clampUiZoom(undefined)).toBe(DEFAULT_UI_ZOOM);
  });
});
