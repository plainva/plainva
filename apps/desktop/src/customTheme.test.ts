// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCustomTheme,
  applyResolved,
  clampCustomTheme,
  clearCustomTheme,
  contrastRatio,
  customAccentPresets,
  customBackgroundPresets,
  customThemeColors,
  customThemeContrast,
  customThemeFromSwatch,
  firstFontFamily,
  CUSTOM_ACCENT_MIN_CONTRAST,
  CUSTOM_BACKGROUND_LIGHTNESS,
  CUSTOM_TEXT_MAIN_MIN_CONTRAST,
  CUSTOM_TEXT_SECONDARY_MIN_CONTRAST,
  CUSTOM_THEME_ID,
  CUSTOM_TOKEN_NAMES,
  defaultCustomTheme,
  deriveCustomTokens,
  formatRatio,
  getThemeDef,
  hexToHsl,
  hslToHex,
  isModePinned,
  nudgeToContrast,
  parseCustomTheme,
  relativeLuminance,
  resolveThemeMode,
  setCustomTheme,
  themesWithCustom,
  AVAILABLE_THEMES,
  type CustomThemeSpec,
} from "@plainva/ui";

/**
 * The user theme's guardrails (plan 2026-09-04, P2). What the user can set is
 * bounded; what they cannot set is derived; and the derivation is checked
 * against WCAG on a grid rather than on three hand-picked examples — the
 * point is that no choice inside the bounds can produce unreadable text.
 */
describe("contrast math", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
    // Petrol's accent on white — the ratio the design docs quote (~5.9).
    expect(contrastRatio("#0f766e", "#ffffff")).toBeGreaterThan(5.3);
    expect(contrastRatio("#0f766e", "#ffffff")).toBeLessThan(6.3);
    expect(formatRatio(4.4999)).toBe("4.5:1");
  });

  it("round-trips hex through HSL", () => {
    for (const hex of ["#0f766e", "#ffffff", "#000000", "#123456", "#abcdef"]) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });

  it("nudges a colour to a ratio along its own hue and leaves a passing one alone", () => {
    const pale = "#c9b7cc"; // ~1.9:1 on white
    const out = nudgeToContrast(pale, "#ffffff", 3);
    expect(out.changed).toBe(true);
    expect(out.ratio).toBeGreaterThanOrEqual(3);
    const before = hexToHsl(pale);
    const after = hexToHsl(out.hex);
    expect(Math.abs(after.h - before.h)).toBeLessThan(2);
    expect(after.l).toBeLessThan(before.l); // darker on a light ground
    expect(nudgeToContrast("#0f766e", "#ffffff", 3)).toMatchObject({ hex: "#0f766e", changed: false });
    // On a dark ground the same colour brightens instead.
    const dark = nudgeToContrast("#2a3a38", "#101414", 3);
    expect(dark.changed).toBe(true);
    expect(hexToHsl(dark.hex).l).toBeGreaterThan(hexToHsl("#2a3a38").l);
  });
});

describe("custom theme guardrails", () => {
  it("keeps every background in its mood's lightness band and says so", () => {
    const { spec, corrections } = clampCustomTheme({ ...defaultCustomTheme("light"), background: "#808080" });
    expect(hexToHsl(spec.background).l).toBeCloseTo(CUSTOM_BACKGROUND_LIGHTNESS.light[0], 2);
    expect(corrections).toEqual([{ field: "background", from: "#808080", to: spec.background }]);
    const dark = clampCustomTheme({ ...defaultCustomTheme("dark"), background: "#ffffff" });
    expect(hexToHsl(dark.spec.background).l).toBeLessThanOrEqual(CUSTOM_BACKGROUND_LIGHTNESS.dark[1] + 0.004);
  });

  it("corrects a pale accent to the floor and reports the ratio it had", () => {
    const { spec, corrections } = clampCustomTheme({ ...defaultCustomTheme("light"), accent: "#c9b7cc" });
    expect(contrastRatio(spec.accent, spec.background)).toBeGreaterThanOrEqual(CUSTOM_ACCENT_MIN_CONTRAST);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ field: "accent", from: "#c9b7cc", to: spec.accent });
    expect(corrections[0].ratio).toBeLessThan(CUSTOM_ACCENT_MIN_CONTRAST);
    // Clamping is idempotent: a clamped spec is left alone.
    expect(clampCustomTheme(spec).corrections).toEqual([]);
  });

  it("derives text that reads on EVERY allowed background, on a grid across both moods", () => {
    for (const mode of ["light", "dark"] as const) {
      const [lo, hi] = CUSTOM_BACKGROUND_LIGHTNESS[mode];
      for (let h = 0; h < 360; h += 30) {
        for (const s of [0, 0.3, 0.6, 1]) {
          for (let l = lo; l <= hi; l += (hi - lo) / 4) {
            const spec: CustomThemeSpec = { ...defaultCustomTheme(mode), background: hslToHex({ h, s, l }) };
            const c = customThemeColors(spec);
            const at = `${mode} h${h} s${s} l${l.toFixed(2)}`;
            expect(contrastRatio(c.textMain, c.background), `main ${at}`).toBeGreaterThanOrEqual(CUSTOM_TEXT_MAIN_MIN_CONTRAST);
            expect(contrastRatio(c.textMuted, c.background), `muted ${at}`).toBeGreaterThanOrEqual(CUSTOM_TEXT_SECONDARY_MIN_CONTRAST);
            expect(contrastRatio(c.textFaint, c.background), `faint ${at}`).toBeGreaterThanOrEqual(CUSTOM_TEXT_SECONDARY_MIN_CONTRAST);
            expect(contrastRatio(c.accent, c.background), `accent ${at}`).toBeGreaterThanOrEqual(CUSTOM_ACCENT_MIN_CONTRAST);
            expect(contrastRatio(c.accentOn, c.accent), `on-accent ${at}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it("every preset passes without a correction", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const background of customBackgroundPresets(mode)) {
        for (const accent of customAccentPresets()) {
          const { corrections } = clampCustomTheme({ ...defaultCustomTheme(mode), background, accent });
          // An accent may legitimately need a nudge on one mood; a background never.
          expect(corrections.filter((c) => c.field === "background"), `${mode} ${background}`).toEqual([]);
        }
      }
    }
  });

  it("starts a spec from a bundled theme's swatch, clamped (A4: the old button read the live tokens)", () => {
    const base = defaultCustomTheme("light");
    const nord = AVAILABLE_THEMES.find((t) => t.id === "nord")!;
    const spec = customThemeFromSwatch(nord.swatch.light!, "light", { ...base, radius: "soft", fontUi: "Georgia" });
    expect(spec.background).toBe(nord.swatch.light!.bg.toLowerCase());
    expect(contrastRatio(spec.accent, spec.background)).toBeGreaterThanOrEqual(CUSTOM_ACCENT_MIN_CONTRAST);
    // Font and corners are the user's, not the bundled theme's.
    expect(spec).toMatchObject({ radius: "soft", fontUi: "Georgia", mode: "light" });
    // A dark swatch into the light mood is clamped into the light band.
    const midnight = AVAILABLE_THEMES.find((t) => t.id === "midnight")!;
    const forced = customThemeFromSwatch(midnight.swatch.dark!, "light", base);
    expect(hexToHsl(forced.background).l).toBeGreaterThanOrEqual(CUSTOM_BACKGROUND_LIGHTNESS.light[0] - 0.004);
  });

  it("names the theme's font by its first family, unquoted", () => {
    expect(firstFontFamily("Inter, Avenir, Helvetica, Arial, sans-serif")).toBe("Inter");
    expect(firstFontFamily('"Segoe UI", system-ui')).toBe("Segoe UI");
    expect(firstFontFamily("  'Fira Sans' ")).toBe("Fira Sans");
    expect(firstFontFamily("")).toBe("");
  });

  it("reports the three ratios the editor shows", () => {
    const r = customThemeContrast(defaultCustomTheme("light"));
    expect(r.textOnBackground).toBeGreaterThanOrEqual(7);
    expect(r.accentOnBackground).toBeGreaterThanOrEqual(3);
    expect(r.onAccent).toBeGreaterThanOrEqual(3);
  });

  it("parses a stored value and rejects garbage", () => {
    expect(parseCustomTheme(null)).toBeNull();
    expect(parseCustomTheme({ mode: "blue" })).toBeNull();
    expect(parseCustomTheme({ mode: "dark", background: "#101414", accent: "#2dd4bf", radius: "soft", fontUi: "Georgia" })).toEqual({
      mode: "dark", background: "#101414", accent: "#2dd4bf", radius: "soft", fontUi: "Georgia",
    });
    // A font name is sanitised on the way in, never trusted as CSS.
    expect(parseCustomTheme({ mode: "light", background: "#ffffff", accent: "#0f766e", fontUi: 'Geo"rgia; }' })?.fontUi).not.toContain(";");
  });
});

describe("custom theme tokens on the document", () => {
  afterEach(() => {
    clearCustomTheme();
    setCustomTheme(null);
  });

  it("writes only the tokens the spec decides, and clears them as a set", () => {
    const spec: CustomThemeSpec = { ...defaultCustomTheme("light"), fontUi: "Georgia", radius: "soft" };
    applyCustomTheme(spec);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--bg-primary")).toBe(spec.background);
    expect(style.getPropertyValue("--font-ui")).toContain('"Georgia"');
    expect(style.getPropertyValue("--radius-md")).toBe("16px");
    // "normal" radius and no font leave those tokens to the base palette.
    applyCustomTheme(defaultCustomTheme("light"));
    expect(style.getPropertyValue("--radius-md")).toBe("");
    expect(style.getPropertyValue("--font-ui")).toBe("");
    clearCustomTheme();
    for (const name of CUSTOM_TOKEN_NAMES) expect(style.getPropertyValue(name), name).toBe("");
    expect(deriveCustomTokens(spec)["--accent-on"]).toBe("#ffffff");
  });

  it("is a registry entry that pins its mood, and applyResolved switches the tokens with the theme", () => {
    expect(getThemeDef(CUSTOM_THEME_ID)).toBeUndefined();
    const spec = defaultCustomTheme("dark");
    setCustomTheme(spec);
    expect(getThemeDef(CUSTOM_THEME_ID)?.modes).toEqual(["dark"]);
    expect(isModePinned(CUSTOM_THEME_ID)).toBe(true);
    expect(resolveThemeMode("light", CUSTOM_THEME_ID)).toBe("dark");

    applyResolved("light", CUSTOM_THEME_ID);
    const root = document.documentElement;
    expect(root.getAttribute("data-theme-name")).toBe(CUSTOM_THEME_ID);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--bg-primary")).toBe(spec.background);

    applyResolved("light", "petrol");
    expect(root.style.getPropertyValue("--bg-primary")).toBe("");
  });

  it("lists the custom card after the regular themes and before the easter eggs", () => {
    const list = themesWithCustom(AVAILABLE_THEMES);
    const at = list.findIndex((t) => t.id === CUSTOM_THEME_ID);
    expect(at).toBe(AVAILABLE_THEMES.findIndex((t) => t.unlock));
    // Win95 keeps its place as the very last card once unlocked.
    expect(list[list.length - 1].id).toBe("win95");
    expect(list).toHaveLength(AVAILABLE_THEMES.length + 1);
    expect(themesWithCustom([AVAILABLE_THEMES[0]])[1].id).toBe(CUSTOM_THEME_ID);
    const dark = themesWithCustom([], defaultCustomTheme("dark"));
    expect(dark[0].swatch.dark?.bg).toBe(defaultCustomTheme("dark").background);
  });
});
