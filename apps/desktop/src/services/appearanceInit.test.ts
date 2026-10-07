// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Re-applying an appearance setting must not take it away first (finding
 * 2026-10-06).
 *
 * `initTagColors` and `initDensity` wrote the DEFAULT before reading the store
 * — "to avoid a flash". Both defaults are "no attribute", so at a cold start
 * that write did nothing. But the two also run whenever another window reports
 * an appearance change; there the write REMOVED the attribute that was set and
 * the stored value put it back a tick later. With tag colours on, every tag
 * blinked grey; in a compact window every row jumped.
 */

const stored: Record<string, unknown> = {};
let release: (() => void) | null = null;
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    // The store answers when the test lets it, so "before the answer" is a
    // moment the test can look at.
    get: (key: string) => new Promise((resolve) => { release = () => resolve(stored[key]); }),
    set: async () => {},
    save: async () => {},
  }),
}));
vi.mock("./appearanceSync", () => ({ notifyAppearanceChanged: () => {} }));

import { initTagColors } from "./tagColors";
import { initDensity } from "./density";

const root = () => document.documentElement;
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  release?.();
  release = null;
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  root().removeAttribute("data-tag-colors");
  root().removeAttribute("data-density");
  for (const key of Object.keys(stored)) delete stored[key];
});
afterEach(() => vi.restoreAllMocks());

describe("re-applying an appearance setting", () => {
  it("tag colours: the attribute that is set stays set while the store is read", async () => {
    stored.tagColors = true;
    root().setAttribute("data-tag-colors", "on");
    const removed = vi.spyOn(root(), "removeAttribute");
    initTagColors();
    expect(root().getAttribute("data-tag-colors")).toBe("on");
    await settle();
    expect(root().getAttribute("data-tag-colors")).toBe("on");
    expect(removed).not.toHaveBeenCalledWith("data-tag-colors");
  });

  it("density: a compact window stays compact while the store is read", async () => {
    stored.density = "compact";
    root().setAttribute("data-density", "compact");
    const removed = vi.spyOn(root(), "removeAttribute");
    initDensity();
    expect(root().getAttribute("data-density")).toBe("compact");
    await settle();
    expect(root().getAttribute("data-density")).toBe("compact");
    expect(removed).not.toHaveBeenCalledWith("data-density");
  });

  it("a setting that was switched OFF elsewhere still arrives", async () => {
    stored.tagColors = false;
    root().setAttribute("data-tag-colors", "on");
    initTagColors();
    await settle();
    expect(root().hasAttribute("data-tag-colors")).toBe(false);

    stored.density = "comfortable";
    root().setAttribute("data-density", "compact");
    initDensity();
    await settle();
    expect(root().hasAttribute("data-density")).toBe(false);
  });

  it("a cold start applies the stored value", async () => {
    stored.tagColors = true;
    initTagColors();
    await settle();
    expect(root().getAttribute("data-tag-colors")).toBe("on");
  });
});
