// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

let storeValues: Record<string, unknown> = {};
const setSpy = vi.fn(async (key: string, value: unknown) => {
  storeValues[key] = value;
});
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async (key: string) => storeValues[key],
    set: setSpy,
    save: async () => {},
  }));
  return { Store: { load }, load };
});

import {
  applyDensity,
  getStoredDensity,
  setStoredDensity,
  initDensity,
  isDensity,
  DEFAULT_DENSITY,
} from "./density";

beforeEach(() => {
  storeValues = {};
  setSpy.mockClear();
  document.documentElement.removeAttribute("data-density");
});

describe("density service", () => {
  it("compact sets the html attribute, comfortable removes it", () => {
    applyDensity("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    applyDensity("comfortable");
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("validates stored values and falls back to the default", async () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("cozy")).toBe(false);
    storeValues["density"] = "cozy";
    expect(await getStoredDensity()).toBe(DEFAULT_DENSITY);
    storeValues["density"] = "compact";
    expect(await getStoredDensity()).toBe("compact");
  });

  it("setStoredDensity persists and applies immediately", async () => {
    await setStoredDensity("compact");
    expect(setSpy).toHaveBeenCalledWith("density", "compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    await setStoredDensity("comfortable");
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("initDensity applies the stored value after the default", async () => {
    storeValues["density"] = "compact";
    initDensity();
    // Default applied synchronously (no attribute), stored value async.
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    await vi.waitFor(() =>
      expect(document.documentElement.getAttribute("data-density")).toBe("compact")
    );
  });
});
