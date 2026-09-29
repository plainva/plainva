// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  appliedTheme,
  applyResolved,
  defaultCustomTheme,
  defaultCustomThemeDesign,
  getCustomThemePreview,
  isModePinned,
  pinnedModeHintKey,
  proposeCustomThemeMood,
  setCustomTheme,
  setCustomThemePreview,
  useCustomThemePair,
  withCustomThemeMood,
  type CustomThemeDesign,
  type CustomThemePairOptions,
} from "@plainva/ui";

/**
 * "My theme": the mood being edited is the mood the app wears (plan Befunde
 * 2026-09-24, E22).
 *
 * The finding: with Mode on Dark, choosing "Light" in the editor changed only
 * the small preview card — the app stayed dark and the work on the light mood
 * was invisible. Now the whole app follows the editor while its page is open,
 * a proposal that is not adopted yet included, without writing the Mode
 * setting; leaving the page brings the stored look back, and so does a
 * restart after a crash mid-preview.
 */

const root = document.documentElement;
const bg = () => root.style.getPropertyValue("--bg-primary");
const mood = () => root.getAttribute("data-theme");

// Both moods adopted, with grounds nobody could confuse.
const pair: CustomThemeDesign = withCustomThemeMood(
  { ...defaultCustomThemeDesign(), light: { ...defaultCustomTheme("light"), background: "#f7f1e8" } },
  { ...defaultCustomTheme("dark"), background: "#1c1815" },
);
// Only the dark mood adopted: the custom theme pins the mode to dark.
const darkOnly: CustomThemeDesign = { version: 2, radius: "normal", light: null, dark: { ...defaultCustomTheme("dark"), background: "#1c1815" } };

let systemDark = false;
beforeEach(() => {
  systemDark = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query.includes("dark") && systemDark, media: query, addEventListener() {}, removeEventListener() {} }),
  });
});
afterEach(() => {
  setCustomThemePreview(null);
  setCustomTheme(null);
  applyResolved("system", "petrol");
});

/** What each shell's start-up does: register the stored design, then apply the stored settings. */
function applyStored(design: CustomThemeDesign | null, pref: "light" | "dark" | "system", name = "custom", variant?: string) {
  setCustomTheme(design);
  applyResolved(pref, name, variant);
}

describe("the preview mood in the registry", () => {
  it.each([
    ["Mode on Dark", "dark" as const, false],
    ["Mode on System, the system dark", "system" as const, true],
  ])("follows the editor light → dark → light with %s, and clearing restores the stored look", (_label, pref, dark) => {
    systemDark = dark;
    applyStored(pair, pref);
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");

    setCustomThemePreview({ mode: "light", spec: pair.light! });
    expect(mood()).toBe("light");
    expect(bg()).toBe("#f7f1e8");
    setCustomThemePreview({ mode: "dark", spec: pair.dark! });
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
    setCustomThemePreview({ mode: "light", spec: pair.light! });
    expect(mood()).toBe("light");
    expect(bg()).toBe("#f7f1e8");

    // The stored look is untouched by all of it — and comes back.
    expect(appliedTheme()).toMatchObject({ pref, name: "custom", mode: "dark" });
    setCustomThemePreview(null);
    expect(getCustomThemePreview()).toBeNull();
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
  });

  it("overrides a one-mood pin and paints a proposal that nothing has stored", () => {
    applyStored(darkOnly, "light");
    expect(isModePinned("custom")).toBe(true);
    expect(mood()).toBe("dark");
    const proposal = proposeCustomThemeMood(darkOnly, "light");
    setCustomThemePreview({ mode: "light", spec: proposal });
    expect(mood()).toBe("light");
    expect(bg()).toBe(proposal.background);
    // Still pinned as stored: the preview is not an adoption.
    expect(isModePinned("custom")).toBe(true);
    expect(pinnedModeHintKey("custom")).toBe("settings.customThemeModePinned");
    setCustomThemePreview(null);
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
  });

  it("wears the custom tokens over another stored theme and gives name and variant back on leaving", () => {
    applyStored(pair, "dark", "lcars", "engage");
    expect(root.getAttribute("data-theme-variant")).toBe("engage");
    setCustomThemePreview({ mode: "light", spec: pair.light! });
    expect(root.getAttribute("data-theme-name")).toBe("custom");
    expect(root.hasAttribute("data-theme-variant")).toBe(false);
    expect(bg()).toBe("#f7f1e8");
    setCustomThemePreview(null);
    expect(root.getAttribute("data-theme-name")).toBe("lcars");
    expect(root.getAttribute("data-theme-variant")).toBe("engage");
    expect(bg()).toBe("");
  });

  it("keeps painting the preview when the stored settings are applied meanwhile, and returns to the newest of them", () => {
    applyStored(pair, "dark");
    setCustomThemePreview({ mode: "light", spec: pair.light! });
    // A save, a System change or a sync arrival re-applies the stored settings.
    applyStored(pair, "system");
    expect(mood()).toBe("light");
    expect(bg()).toBe("#f7f1e8");
    expect(appliedTheme()).toMatchObject({ pref: "system", mode: "light" });
    systemDark = true;
    applyStored(pair, "system");
    setCustomThemePreview(null);
    expect(mood()).toBe("dark");
  });

  it("keeps the stored theme's pin for the light/dark toggle while <html> wears a pinned preview", () => {
    // Stored: Petrol on Dark, free to toggle. Previewed: a one-mood "My theme",
    // which pins — the title bar and the palette's toggle command must still
    // see the stored theme (they used to read data-theme-name off <html>).
    applyStored(darkOnly, "dark", "petrol");
    setCustomThemePreview({ mode: "dark", spec: darkOnly.dark! });
    expect(root.getAttribute("data-theme-name")).toBe("custom");
    expect(isModePinned("custom")).toBe(true);
    expect(appliedTheme()).toMatchObject({ name: "petrol", mode: "dark", pinned: false });
    setCustomThemePreview(null);
    applyStored(darkOnly, "dark");
    expect(appliedTheme().pinned).toBe(true);
  });

  it("is never stored: a restart after a crash mid-preview paints the stored settings", async () => {
    applyStored(pair, "dark");
    const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i)!)]));
    const before = { local: dump(localStorage), session: dump(sessionStorage) };
    setCustomThemePreview({ mode: "light", spec: pair.light! });
    expect(mood()).toBe("light");
    expect({ local: dump(localStorage), session: dump(sessionStorage) }).toEqual(before);

    // The page dies without cleaning up; the next start is a fresh module
    // over whatever the old one left on <html>.
    vi.resetModules();
    const fresh = await import("../../../packages/ui/src/lib/themeRegistry");
    expect(fresh.getCustomThemePreview()).toBeNull();
    fresh.setCustomTheme(pair);
    fresh.applyResolved("dark", "custom");
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
    fresh.applyResolved("dark", "petrol");
    expect(bg()).toBe("");
  });
});

describe("useCustomThemePair drives the preview", () => {
  let host: HTMLDivElement;
  let reactRoot: Root;
  let latest: ReturnType<typeof useCustomThemePair>;
  const saves: CustomThemeDesign[] = [];
  const Harness = ({ design, options }: { design: CustomThemeDesign; options?: CustomThemePairOptions }) => {
    latest = useCustomThemePair(design, (next) => { saves.push(next); }, options);
    return null;
  };
  const render = (design: CustomThemeDesign, options?: CustomThemePairOptions) =>
    act(() => { reactRoot.render(<Harness design={design} options={options} />); });

  beforeEach(() => {
    saves.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    reactRoot = createRoot(host);
  });
  afterEach(() => {
    act(() => reactRoot.unmount());
    host.remove();
  });

  it("starts on the mood the app shows — not on light because a light mood exists", () => {
    applyStored(pair, "dark");
    render(pair);
    expect(latest.mode).toBe("dark");
    expect(mood()).toBe("dark");
  });

  it("starts on the pinned mood even while the desktop still holds its light placeholder", () => {
    applyStored(darkOnly, "light");
    // Every settings page is mounted with defaultCustomThemeDesign() until the store answers.
    render(defaultCustomThemeDesign(), { active: false });
    expect(latest.mode).toBe("dark");
    render(darkOnly, { active: true });
    expect(latest.mode).toBe("dark");
    expect(latest.pending).toBe(false);
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
  });

  it("repaints the whole app on every switch, shows a proposal without saving it, and leaving restores Mode", () => {
    applyStored(darkOnly, "dark");
    render(darkOnly);
    act(() => latest.setMode("light"));
    expect(latest.pending).toBe(true);
    expect(mood()).toBe("light");
    expect(bg()).toBe(proposeCustomThemeMood(darkOnly, "light").background);
    // A colour change of the proposal paints at once and still saves nothing.
    act(() => latest.update({ ...latest.spec, background: "#eef4ff" }));
    expect(bg()).toBe("#eef4ff");
    expect(saves).toEqual([]);
    act(() => latest.setMode("dark"));
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
    act(() => latest.setMode("light"));
    expect(bg()).toBe("#eef4ff");
    act(() => reactRoot.unmount());
    reactRoot = createRoot(host);
    expect(getCustomThemePreview()).toBeNull();
    expect(mood()).toBe("dark");
    expect(bg()).toBe("#1c1815");
    expect(saves).toEqual([]);
  });

  it("previews only while active, clears on inactive, and starts on the shown mood again on return", () => {
    applyStored(pair, "dark");
    render(pair, { active: false });
    expect(getCustomThemePreview()).toBeNull();
    render(pair, { active: true });
    expect(getCustomThemePreview()).toMatchObject({ mode: "dark" });
    act(() => latest.setMode("light"));
    expect(mood()).toBe("light");
    // Another settings page is chosen: the page stays mounted, the preview ends.
    render(pair, { active: false });
    expect(getCustomThemePreview()).toBeNull();
    expect(mood()).toBe("dark");
    render(pair, { active: true });
    expect(latest.mode).toBe("dark");
    expect(mood()).toBe("dark");
  });

  it("follows the stored look that arrives after it mounted, until somebody switches", () => {
    // The desktop paints System + the default theme first, then the store.
    applyStored(null, "system", "petrol");
    render(pair);
    expect(latest.mode).toBe("light");
    act(() => applyStored(darkOnly, "light"));
    expect(latest.mode).toBe("dark");
    expect(mood()).toBe("dark");
    act(() => latest.setMode("light"));
    act(() => applyStored(pair, "dark"));
    expect(latest.mode).toBe("light");
    expect(mood()).toBe("light");
  });

  it("hands every change to the preview callback it is given", () => {
    applyStored(pair, "dark");
    const calls: Array<string | null> = [];
    const preview = (p: { mode: string } | null) => { calls.push(p ? p.mode : null); };
    render(pair, { preview });
    act(() => latest.setMode("light"));
    act(() => reactRoot.unmount());
    reactRoot = createRoot(host);
    expect(calls).toEqual(["dark", "light", null]);
    // The registry itself was never touched.
    expect(mood()).toBe("dark");
  });
});
