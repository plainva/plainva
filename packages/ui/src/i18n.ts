import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { APP_LANGUAGES, DEFAULT_LANGUAGE, matchAppLanguage } from './services/languages';

// Locale bundles load LAZILY (P2.8): all ten JSONs together are ~580 KB —
// roughly 40 % of the former initial bundle — while a session ever uses one
// language plus the English fallback. Adding a language still just means
// dropping the JSON into ./locales/ and registering it in APP_LANGUAGES; the
// locale parity test enforces that registry and files stay 1:1. Tests load
// every bundle eagerly via src/test-setup.ts instead.
const localeLoaders = import.meta.glob('./locales/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, unknown> }>
>;

async function loadLanguage(code: string): Promise<void> {
  if (i18n.hasResourceBundle(code, 'translation')) return;
  const loader = localeLoaders[`./locales/${code}.json`];
  if (!loader) return;
  const mod = await loader();
  i18n.addResourceBundle(code, 'translation', mod.default, true, true);
}

const getOsLanguage = () =>
  matchAppLanguage(navigator.language || (navigator as { userLanguage?: string }).userLanguage);

const initialLanguage = getOsLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

/**
 * Resolves once the initial language (plus the English fallback) is loaded.
 * main.tsx awaits this before the first render so no raw keys ever flash.
 */
export const i18nReady: Promise<void> = Promise.all([
  loadLanguage(initialLanguage),
  loadLanguage(DEFAULT_LANGUAGE),
]).then(() => {
  // Re-announce the language so anything rendered early re-reads its strings.
  return i18n.changeLanguage(i18n.language).then(() => undefined);
});

/** Switches the app language, loading its bundle on demand first. */
export async function changeAppLanguage(code: string): Promise<void> {
  const resolved = APP_LANGUAGES.some((l) => l.code === code) ? code : matchAppLanguage(code);
  await loadLanguage(resolved);
  await i18n.changeLanguage(resolved);
}

/**
 * Test-only helper: loads every bundled locale eagerly. Vitest setups await
 * this so synchronous renders never show raw keys; the app itself only ever
 * loads the active language plus the English fallback.
 */
export async function loadAllLanguages(): Promise<void> {
  await Promise.all(
    Object.keys(localeLoaders).map((path) =>
      loadLanguage(path.replace("./locales/", "").replace(".json", "")),
    ),
  );
}

export default i18n;
