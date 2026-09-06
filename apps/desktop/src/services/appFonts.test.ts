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
// The custom theme's store binding applies the theme on write; here only the
// spec's fontUi field matters (the migration reads and clears it).
vi.mock("./theme", () => ({
  getStoredCustomTheme: async () => storeValues.customTheme ?? { mode: "light", background: "#ffffff", accent: "#0f766e", fontUi: "", radius: "normal" },
  setStoredCustomTheme: async (spec: unknown) => {
    storeValues.customTheme = spec;
  },
}));

import {
  applyContentFontFamily,
  applyContentFontSize,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  getStoredAppFonts,
  migrateInterfaceFontFromCustomTheme,
  resolveFontFamilyValue,
  sanitizeFontName,
  setStoredAppFonts,
} from "./appFonts";
import { applyAppFont, defaultAppFonts, resolveFontChoiceValue } from "@plainva/ui";
import { clampUiZoom, DEFAULT_UI_ZOOM } from "./uiZoom";

const root = () => document.documentElement.style;

describe("appFonts", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
    for (const p of ["--content-font-size", "--font-content", "--font-ui", "--font-family", "--font-mono"]) root().removeProperty(p);
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

  it("gives a custom code font a monospace fallback, the other slots a sans one (issue #82)", () => {
    expect(resolveFontChoiceValue("code", { family: "custom", customName: "JetBrains Mono" })).toMatch(/^"JetBrains Mono", ui-monospace/);
    expect(resolveFontChoiceValue("ui", { family: "custom", customName: "Atkinson" })).toMatch(/^"Atkinson", Inter/);
  });

  it("applies each slot onto its own tokens and removes them for theme", () => {
    applyContentFontSize(18);
    expect(root().getPropertyValue("--content-font-size")).toBe("18px");
    applyContentFontFamily("mono", "");
    expect(root().getPropertyValue("--font-content")).toContain("monospace");
    applyContentFontFamily("theme", "");
    expect(root().getPropertyValue("--font-content")).toBe("");

    applyAppFont("ui", { family: "custom", customName: "Atkinson" });
    expect(root().getPropertyValue("--font-ui")).toMatch(/^"Atkinson"/);
    expect(root().getPropertyValue("--font-family")).toMatch(/^"Atkinson"/);
    applyAppFont("code", { family: "mono", customName: "" });
    expect(root().getPropertyValue("--font-mono")).toContain("monospace");
    applyAppFont("ui", { family: "theme", customName: "" });
    expect(root().getPropertyValue("--font-ui")).toBe("");
    expect(root().getPropertyValue("--font-family")).toBe("");
  });

  it("persists and restores all three slots through the store, content on its old keys", async () => {
    const fonts = defaultAppFonts();
    fonts.content = { family: "custom", customName: ' "Fira Sans" ' };
    fonts.code = { family: "custom", customName: "Cascadia Code" };
    await setStoredAppFonts({ size: 30, fonts });
    expect(storeValues.contentFontSize).toBe(24);
    expect(storeValues.contentFontCustom).toBe("Fira Sans");
    expect(storeValues.contentFontFamily).toBe("custom");
    expect(storeValues.codeFontFamily).toBe("custom");
    expect(storeValues.uiFontFamily).toBe("theme");
    const restored = await getStoredAppFonts();
    expect(restored).toEqual({
      size: 24,
      fonts: {
        ui: { family: "theme", customName: "" },
        content: { family: "custom", customName: "Fira Sans" },
        code: { family: "custom", customName: "Cascadia Code" },
      },
    });
  });

  it("reads a 0.8.0 store (content keys only) as before", async () => {
    storeValues.contentFontFamily = "serif";
    storeValues.contentFontSize = 14;
    const s = await getStoredAppFonts();
    expect(s.size).toBe(14);
    expect(s.fonts.content).toEqual({ family: "serif", customName: "" });
    expect(s.fonts.ui.family).toBe("theme");
    expect(s.fonts.code.family).toBe("theme");
  });

  describe("migration of the custom theme's interface font (E2)", () => {
    const spec = { mode: "light", background: "#ffffff", accent: "#0f766e", fontUi: "Georgia", radius: "normal" };

    it("moves fontUi into the interface slot once and clears the spec", async () => {
      storeValues.customTheme = { ...spec };
      expect(await migrateInterfaceFontFromCustomTheme()).toBe(true);
      expect(storeValues.uiFontFamily).toBe("custom");
      expect(storeValues.uiFontCustom).toBe("Georgia");
      expect((storeValues.customTheme as { fontUi: string }).fontUi).toBe("");
      expect(root().getPropertyValue("--font-ui")).toMatch(/^"Georgia"/);
      // A second run has nothing left to move.
      expect(await migrateInterfaceFontFromCustomTheme()).toBe(false);
    });

    it("never overwrites an interface font the user has since chosen", async () => {
      storeValues.customTheme = { ...spec };
      storeValues.uiFontFamily = "sans";
      expect(await migrateInterfaceFontFromCustomTheme()).toBe(false);
      expect(storeValues.uiFontFamily).toBe("sans");
      expect((storeValues.customTheme as { fontUi: string }).fontUi).toBe("");
    });

    it("does nothing for a spec without a font", async () => {
      storeValues.customTheme = { ...spec, fontUi: "" };
      expect(await migrateInterfaceFontFromCustomTheme()).toBe(false);
      expect(storeValues.uiFontFamily).toBeUndefined();
    });
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

describe("resolveFontFamilyValue with the catalog's generic keywords (P12)", () => {
  it("leaves a generic family keyword unquoted and quotes a real name", () => {
    expect(resolveFontFamilyValue("custom", "ui-serif")).toMatch(/^ui-serif, /);
    expect(resolveFontFamilyValue("custom", "-apple-system")).toMatch(/^-apple-system, /);
    expect(resolveFontFamilyValue("custom", "Avenir Next")).toMatch(/^"Avenir Next", /);
  });
});
