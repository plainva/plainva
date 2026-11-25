import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { APP_LANGUAGES, DEFAULT_LANGUAGE, matchAppLanguage } from './services/languages';
import { loadDateLocale } from './lib/dateLocale';
import LOCALE_AREAS from './localeAreas.json';

// Locale bundles load LAZILY (P2.8): all ten JSONs together are ~580 KB —
// roughly 40 % of the former initial bundle — while a session ever uses one
// language plus the English fallback. Adding a language still just means
// dropping the JSON into ./locales/ and registering it in APP_LANGUAGES; the
// locale parity test enforces that registry and files stay 1:1. Tests load
// every bundle eagerly via src/test-setup.ts instead.
//
// Each language loads in areas (performance plan L5): the core, which the start waits for, and the AI, the
// settings and mail, which load right beside it and land a moment later. The source stays one file per language;
// the build cuts it (`scripts/vite/localeAreas.mjs`, the areas in `localeAreas.json`).
type LocaleLoaders = Record<string, () => Promise<Record<string, unknown>>>;
const coreLoaders = import.meta.glob('./locales/*.json', { query: { area: 'core' }, import: 'default' }) as LocaleLoaders;
const areaLoaders: Record<string, LocaleLoaders> = {
  ai: import.meta.glob('./locales/*.json', { query: { area: 'ai' }, import: 'default' }) as LocaleLoaders,
  settings: import.meta.glob('./locales/*.json', { query: { area: 'settings' }, import: 'default' }) as LocaleLoaders,
  mail: import.meta.glob('./locales/*.json', { query: { area: 'mail' }, import: 'default' }) as LocaleLoaders,
};
const AREA_OF_KEY = new Map(Object.entries(LOCALE_AREAS as Record<string, string[]>).flatMap(([area, keys]) => keys.map((key) => [key, area] as const)));

/** The areas of each language that are still on their way. */
const pendingAreas = new Map<string, Set<string>>();
const loadedCore = new Set<string>();
const areaLoads = new Map<string, Promise<void>>();

function loadAreas(code: string): Promise<void> {
  let loading = areaLoads.get(code);
  if (!loading) {
    const pending = new Set(Object.keys(areaLoaders));
    pendingAreas.set(code, pending);
    loading = Promise.all(
      Object.entries(areaLoaders).map(async ([area, loaders]) => {
        const loader = loaders[`./locales/${code}.json`];
        try {
          if (loader) i18n.addResourceBundle(code, 'translation', await loader(), true, true);
        } finally {
          pending.delete(area);
        }
      }),
    ).then(() => undefined);
    areaLoads.set(code, loading);
  }
  return loading;
}

/**
 * Loads a language: its core, and its other areas beside it. `areas: "await"` waits for all of them (a language the
 * person switches to); at the start only the core is waited for.
 */
async function loadLanguage(code: string, areas: "await" | "beside" = "await"): Promise<void> {
  const loader = coreLoaders[`./locales/${code}.json`];
  if (!loader) return;
  const rest = loadAreas(code);
  if (!loadedCore.has(code)) {
    i18n.addResourceBundle(code, 'translation', await loader(), true, true);
    loadedCore.add(code);
  }
  if (areas === "await") await rest;
  else void rest.catch(() => undefined);
}

/**
 * A key of an area that is still on its way reads as nothing for that moment, never as the key itself; the text
 * follows when the area lands (`bindI18nStore: "added"` re-renders what asked).
 */
function missingKey(key: string): string {
  const area = AREA_OF_KEY.get(key.split('.')[0]!);
  const language = i18n.language;
  if (area && (pendingAreas.get(language)?.has(area) || pendingAreas.get(DEFAULT_LANGUAGE)?.has(area))) return '';
  return key;
}

const getOsLanguage = () =>
  matchAppLanguage(navigator.language || (navigator as { userLanguage?: string }).userLanguage);

const initialLanguage = getOsLanguage();

void i18n
  .use(initReactI18next)
  .init({
    resources: {},
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
      escapeValue: false // react already safes from xss
    },
    parseMissingKeyHandler: missingKey,
    react: { bindI18nStore: 'added' },
  });

/**
 * The document's language follows the app's (plan Befunde 2026-10-06, S1).
 *
 * Both shells' index.html say `lang="en"`, and until now nothing ever changed
 * it: a German interface announced itself as English to a screen reader, and
 * to everything in the WebView that picks by language - the spell checker
 * where it reads the attribute, the Han glyph variants for Japanese against
 * Chinese. No stylesheet of the app selects on `:lang()` or hyphenates, so
 * the attribute changes nothing the app itself draws.
 */
function reflectDocumentLanguage(code: string | undefined): void {
  if (typeof document === "undefined" || !code) return;
  document.documentElement.lang = code;
}
i18n.on("languageChanged", reflectDocumentLanguage);
reflectDocumentLanguage(initialLanguage);

/**
 * Resolves once the core of the initial language (plus the English fallback) is loaded.
 * main.tsx awaits this before the first render so no raw keys ever flash; the other areas land a moment later.
 */
export const i18nReady: Promise<void> = Promise.all([
  loadLanguage(initialLanguage, "beside"),
  loadLanguage(DEFAULT_LANGUAGE, "beside"),
  // Dates a person READS follow the app language too (`{{date:dddd}}` in a
  // template). The locale has to be resident before the first template runs,
  // because the engine resolves tokens synchronously.
  loadDateLocale(initialLanguage),
]).then(() => {
  // Re-announce the language so anything rendered early re-reads its strings.
  return i18n.changeLanguage(i18n.language).then(() => undefined);
});

/** Switches the app language, loading its bundle on demand first. */
export async function changeAppLanguage(code: string): Promise<void> {
  const resolved = APP_LANGUAGES.some((l) => l.code === code) ? code : matchAppLanguage(code);
  await Promise.all([loadLanguage(resolved), loadDateLocale(resolved)]);
  await i18n.changeLanguage(resolved);
}

/**
 * Test-only helper: loads every bundled locale eagerly. Vitest setups await
 * this so synchronous renders never show raw keys; the app itself only ever
 * loads the active language plus the English fallback.
 */
export async function loadAllLanguages(): Promise<void> {
  await Promise.all(
    Object.keys(coreLoaders).map((path) =>
      loadLanguage(path.replace("./locales/", "").replace(".json", "")),
    ),
  );
}

/**
 * Test-only seam, offered here beside `loadAllLanguages` so a test setup can pin
 * the date locale without the package barrel — importing that would load all of
 * @plainva/ui in front of every single test file (Befunde 2026-09-24, Z2).
 */
export { setDateLocaleForTests } from './lib/dateLocale';

export default i18n;
