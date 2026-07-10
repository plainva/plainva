/**
 * Central app-language registry (Gesamtplan Sprachen 2026-07-04). One entry per
 * supported UI language; the BCP-47 code doubles as the locale JSON basename
 * (src/locales/<code>.json) and the user-guide folder name (docs/user/<code>/).
 *
 * Adding a language = one entry here + the locale JSON (i18n.ts picks it up
 * automatically) + templates.<code>.ts (optional, falls back to English) +
 * the docs/user/<code>/ guide. Conventions: docs/engineering/Translation_Glossary.md.
 */

export interface AppLanguage {
  /** BCP-47 tag; equals the locale JSON basename and the docs/user folder. */
  code: string;
  /** Native self-name — shown untranslated in the language picker. */
  nativeName: string;
}

export const APP_LANGUAGES: AppLanguage[] = [
  { code: "en", nativeName: "English" },
  { code: "de", nativeName: "Deutsch" },
  { code: "fr", nativeName: "Français" },
  { code: "es", nativeName: "Español" },
  { code: "pt-BR", nativeName: "Português (Brasil)" },
  { code: "it", nativeName: "Italiano" },
  { code: "nl", nativeName: "Nederlands" },
  { code: "pl", nativeName: "Polski" },
  { code: "zh-CN", nativeName: "简体中文" },
  { code: "ja", nativeName: "日本語" },
];

export const DEFAULT_LANGUAGE = "en";

/**
 * Maps an arbitrary language tag (OS locale, stored setting, i18n.language) to
 * a supported code: exact match first (case-insensitive), then primary-subtag
 * match ("pt-PT" → "pt-BR", "zh" → "zh-CN"), else English.
 */
export function matchAppLanguage(tag: string | null | undefined): string {
  if (!tag) return DEFAULT_LANGUAGE;
  const lower = tag.toLowerCase();
  const exact = APP_LANGUAGES.find((l) => l.code.toLowerCase() === lower);
  if (exact) return exact.code;
  const primary = lower.split("-")[0];
  const byPrefix = APP_LANGUAGES.find((l) => l.code.toLowerCase().split("-")[0] === primary);
  return byPrefix ? byPrefix.code : DEFAULT_LANGUAGE;
}
