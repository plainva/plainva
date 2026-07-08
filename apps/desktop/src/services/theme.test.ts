import { beforeEach, describe, expect, it, vi } from "vitest";

// theme.ts only needs the store filename from VaultContext — mock it so the
// test never pulls React/Tauri context code.
vi.mock("../contexts/VaultContext", () => ({ STORE_KEY: "test-settings.json" }));

// In-memory Tauri store; reset per test.
const storeData = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: async () => ({
      get: async (key: string) => storeData.get(key),
      set: async (key: string, value: unknown) => void storeData.set(key, value),
      save: async () => {},
    }),
  },
}));

import {
  AVAILABLE_THEMES,
  LCARS_VARIANTS,
  activateEasterEggTheme,
  activateEasterEggThemeNoVariant,
  addUnlockedVariant,
  deactivateEasterEggTheme,
  getStoredThemeName,
  getUnlockedThemes,
  getUnlockedVariants,
  isModePinned,
  resolveThemeMode,
  visibleThemes,
} from "./theme";

beforeEach(() => storeData.clear());

describe("registry consistency", () => {
  it("has unique theme ids", () => {
    const ids = AVAILABLE_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides a swatch for every shipped mode", () => {
    for (const def of AVAILABLE_THEMES) {
      expect(def.modes.length).toBeGreaterThan(0);
      for (const mode of def.modes) {
        expect(def.swatch[mode], `${def.id} misses swatch for ${mode}`).toBeDefined();
      }
    }
  });

  it("lcars ships all collectible variants with a default", () => {
    const lcars = AVAILABLE_THEMES.find((t) => t.id === "lcars");
    expect(lcars?.unlock).toBe("easteregg");
    expect(lcars?.variants).toEqual(LCARS_VARIANTS);
    expect(LCARS_VARIANTS.some((v) => v.id === lcars?.defaultVariant)).toBe(true);
  });

  it("win95 is easter-egg gated and deliberately the LAST picker card (2026-07-06)", () => {
    const win95 = AVAILABLE_THEMES.find((t) => t.id === "win95");
    expect(win95?.unlock).toBe("easteregg");
    expect(AVAILABLE_THEMES[AVAILABLE_THEMES.length - 1].id).toBe("win95");
    // Once unlocked it is also the last VISIBLE card.
    const visible = visibleThemes(["lcars", "win95"]);
    expect(visible[visible.length - 1].id).toBe("win95");
  });
});

describe("resolveThemeMode (mode pinning)", () => {
  it("pins single-mode themes regardless of the preference", () => {
    for (const pref of ["light", "dark", "system"] as const) {
      expect(resolveThemeMode(pref, "lcars")).toBe("dark");
      expect(resolveThemeMode(pref, "midnight")).toBe("dark");
      expect(resolveThemeMode(pref, "phosphor-green")).toBe("dark");
      expect(resolveThemeMode(pref, "phosphor-amber")).toBe("dark");
      // Windows 95 is the first LIGHT-pinned theme.
      expect(resolveThemeMode(pref, "win95")).toBe("light");
    }
  });

  it("follows the preference for multi-mode themes", () => {
    expect(resolveThemeMode("light", "petrol")).toBe("light");
    expect(resolveThemeMode("dark", "nord")).toBe("dark");
    // "system" without matchMedia (node env) falls back to light.
    expect(resolveThemeMode("system", "solarized")).toBe("light");
  });

  it("reports pinning per theme", () => {
    expect(isModePinned("lcars")).toBe(true);
    expect(isModePinned("midnight")).toBe(true);
    expect(isModePinned("win95")).toBe(true);
    expect(isModePinned("gruvbox")).toBe(false);
    expect(isModePinned("does-not-exist")).toBe(false);
  });
});

describe("easter-egg gating", () => {
  it("hides locked themes from the picker until unlocked", () => {
    const lockedIds = visibleThemes([]).map((t) => t.id);
    expect(lockedIds).not.toContain("lcars");
    expect(lockedIds).not.toContain("win95");
    expect(lockedIds).toContain("petrol");
    expect(lockedIds).toContain("phosphor-green");

    const unlockedIds = visibleThemes(["lcars"]).map((t) => t.id);
    expect(unlockedIds).toContain("lcars");
    expect(unlockedIds).not.toContain("win95");
  });

  it("activateEasterEggThemeNoVariant unlocks + switches without touching variants", async () => {
    storeData.set("themeName", "petrol");
    await activateEasterEggThemeNoVariant("win95");
    expect(await getStoredThemeName()).toBe("win95");
    expect(await getUnlockedThemes()).toContain("win95");
    // No variant machinery for variant-less themes.
    expect(storeData.get("themeVariants")).toBeUndefined();
    expect(storeData.get("unlockedThemeVariants")).toBeUndefined();

    // Re-transmitting while active must NOT overwrite the remembered theme.
    await activateEasterEggThemeNoVariant("win95");
    await deactivateEasterEggTheme("win95");
    expect(await getStoredThemeName()).toBe("petrol");
  });

  it("collects variants without duplicates", async () => {
    expect(await addUnlockedVariant("lcars", "engage")).toEqual(["engage"]);
    expect(await addUnlockedVariant("lcars", "qapla")).toEqual(["engage", "qapla"]);
    expect(await addUnlockedVariant("lcars", "engage")).toEqual(["engage", "qapla"]);
    expect((await getUnlockedVariants())["lcars"]).toEqual(["engage", "qapla"]);
  });

  it("activateEasterEggTheme unlocks, activates and remembers the previous theme", async () => {
    storeData.set("themeName", "nord");
    await activateEasterEggTheme("lcars", "make-it-so");
    expect(await getStoredThemeName()).toBe("lcars");
    expect(await getUnlockedThemes()).toContain("lcars");
    expect((await getUnlockedVariants())["lcars"]).toContain("make-it-so");
    expect(storeData.get("themeVariants")).toEqual({ lcars: "make-it-so" });

    // A second line while LCARS is active must NOT overwrite the remembered theme.
    await activateEasterEggTheme("lcars", "red-alert");
    expect(storeData.get("themeVariants")).toEqual({ lcars: "red-alert" });

    await deactivateEasterEggTheme("lcars");
    expect(await getStoredThemeName()).toBe("nord");
  });

  it("deactivating falls back to the default theme when nothing was remembered", async () => {
    await deactivateEasterEggTheme("lcars");
    expect(await getStoredThemeName()).toBe("petrol");
  });
});
