import { describe, expect, it, vi } from "vitest";

/**
 * The start waits for every area of its language (review of L5, 2026-11-25). A message the start puts up — the
 * settings sync's, the AI's, mail's — reads its text when it is made; with the areas landing a moment after the core,
 * a text of an area still on its way read as nothing, and a message made in that moment stayed empty. `i18nReady`
 * resolves once every area of the language and of the English fallback is there.
 */
describe("the start's language", () => {
  it("has every area loaded when i18nReady resolves", async () => {
    expect.hasAssertions();
    vi.resetModules();
    const fresh = await import("../../../packages/ui/src/i18n");
    await fresh.i18nReady;
    const t = fresh.default.getFixedT("en");
    for (const key of ["settingsSync.profileFailed", "ai.start", "mail.title", "settings.syncErrorHistory"]) {
      const text = t(key, { error: "x" });
      expect(text, key).not.toBe("");
      expect(text, key).not.toBe(key);
    }
    // Nothing is on its way: a missing key of an area reads as its default, not as nothing.
    expect(fresh.missingKey("settingsSync.zzProbe", "Default")).toBe("Default");
    expect(fresh.missingKey("ai.zzProbe", "Default")).toBe("Default");
  });
});
