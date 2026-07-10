import { describe, it, expect } from "vitest";
import { APP_LANGUAGES, DEFAULT_LANGUAGE, matchAppLanguage } from "@plainva/ui";

describe("app language registry (Gesamtplan Sprachen 2026-07-04)", () => {
  it("carries unique, well-formed BCP-47 codes and native names", () => {
    const codes = APP_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const lang of APP_LANGUAGES) {
      expect(lang.code).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
      expect(lang.nativeName.length).toBeGreaterThan(1);
    }
    expect(codes).toContain(DEFAULT_LANGUAGE);
  });

  it("matches exact tags case-insensitively", () => {
    expect(matchAppLanguage("de")).toBe("de");
    expect(matchAppLanguage("pt-br")).toBe("pt-BR");
    expect(matchAppLanguage("ZH-CN")).toBe("zh-CN");
  });

  it("falls back to the primary subtag (regional variants pick the shipped variant)", () => {
    expect(matchAppLanguage("de-AT")).toBe("de");
    expect(matchAppLanguage("fr-CA")).toBe("fr");
    expect(matchAppLanguage("pt-PT")).toBe("pt-BR");
    expect(matchAppLanguage("pt")).toBe("pt-BR");
    expect(matchAppLanguage("zh")).toBe("zh-CN");
    expect(matchAppLanguage("zh-TW")).toBe("zh-CN");
    expect(matchAppLanguage("ja-JP")).toBe("ja");
  });

  it("unknown or missing tags fall back to English", () => {
    expect(matchAppLanguage("ko")).toBe(DEFAULT_LANGUAGE);
    expect(matchAppLanguage("")).toBe(DEFAULT_LANGUAGE);
    expect(matchAppLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(matchAppLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
  });
});
