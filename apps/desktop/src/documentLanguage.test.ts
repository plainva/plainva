// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import i18n, { changeAppLanguage } from "@plainva/ui/i18n";

/**
 * The document's language follows the app's (plan Befunde 2026-10-06, S1).
 * Both shells ship `<html lang="en">`; until this, a German or Japanese
 * interface kept announcing itself as English to the screen reader and to
 * everything in the WebView that picks by language.
 */
describe("document language", () => {
  it("is the app language from the start", () => {
    expect(document.documentElement.lang).toBe(i18n.language);
  });

  it("follows every language change", async () => {
    for (const code of ["de", "ja", "pt-BR", "zh-CN", "en"]) {
      await changeAppLanguage(code);
      expect(document.documentElement.lang).toBe(code);
    }
  });
});
