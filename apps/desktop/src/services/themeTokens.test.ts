// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetThemeTokenCache, getGraphThemeTokens, subscribeGraphThemeTokens } from "./themeTokens";

describe("themeTokens", () => {
  afterEach(() => {
    __resetThemeTokenCache();
    document.documentElement.removeAttribute("data-theme");
  });

  it("reads the full token set with 8 chip pairs and a duration fallback", () => {
    const tokens = getGraphThemeTokens();
    expect(tokens.chips.length).toBe(8);
    // jsdom resolves no custom properties -> parse falls back to 180ms.
    expect(tokens.durationMs).toBe(180);
    expect(typeof tokens.accent).toBe("string");
    expect(tokens.fontUi.length).toBeGreaterThan(0); // "sans-serif" fallback
  });

  it("caches until a theme attribute changes, then notifies subscribers", async () => {
    const first = getGraphThemeTokens();
    expect(getGraphThemeTokens()).toBe(first); // cached identity

    const cb = vi.fn();
    const unsubscribe = subscribeGraphThemeTokens(cb);
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver microtask
    expect(cb).toHaveBeenCalled();
    expect(getGraphThemeTokens()).not.toBe(first); // cache dropped

    unsubscribe();
    cb.mockClear();
    document.documentElement.setAttribute("data-theme", "light");
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).not.toHaveBeenCalled();
  });
});
