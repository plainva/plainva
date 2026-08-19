import type { Locale } from "date-fns";

/**
 * The date-fns locale that belongs to the current app language.
 *
 * Kept as a module cache rather than passed through every call because the
 * template engine resolves tokens SYNCHRONOUSLY: a template is filled in the
 * middle of creating a note, and there is no point in that call chain where an
 * `await import("date-fns/locale/de")` could go. So the locale is loaded once,
 * where the language is switched (i18n.ts), and read synchronously from here —
 * the same shape the lazy locale bundles already use.
 *
 * Until a locale is loaded this reports `undefined`, and date-fns falls back to
 * en-US. That is the correct behaviour for the first frames after start and for
 * every unit test that never switches language: English stays the default, and
 * localisation is something a caller opts into (see `formatMomentLocalized`).
 *
 * `en` deliberately has no loader — en-US IS the date-fns default, so the
 * English UI costs no chunk at all.
 */

/** App language code → date-fns locale. One literal import per entry, because
 *  a computed specifier cannot be statically analysed by the bundler. */
const LOADERS: Record<string, () => Promise<Locale>> = {
  de: () => import("date-fns/locale/de").then((m) => m.de),
  fr: () => import("date-fns/locale/fr").then((m) => m.fr),
  es: () => import("date-fns/locale/es").then((m) => m.es),
  "pt-BR": () => import("date-fns/locale/pt-BR").then((m) => m.ptBR),
  it: () => import("date-fns/locale/it").then((m) => m.it),
  nl: () => import("date-fns/locale/nl").then((m) => m.nl),
  pl: () => import("date-fns/locale/pl").then((m) => m.pl),
  "zh-CN": () => import("date-fns/locale/zh-CN").then((m) => m.zhCN),
  ja: () => import("date-fns/locale/ja").then((m) => m.ja),
};

let active: Locale | undefined;
/** The code whose load is currently the wanted one — guards against a slow
 *  first request landing after a faster second one and winning. */
let wanted = "en";

/** The active date-fns locale, or `undefined` for English (the date-fns default). */
export function getDateLocale(): Locale | undefined {
  return active;
}

/**
 * Loads the locale for `code` and makes it the active one. Unknown codes and
 * `en` clear the locale, which is what makes switching BACK to English work.
 *
 * Never throws: a missing locale chunk must not stop a language switch — it
 * only means dates stay English.
 */
export async function loadDateLocale(code: string): Promise<void> {
  wanted = code;
  const loader = LOADERS[code];
  if (!loader) {
    active = undefined;
    return;
  }
  try {
    const locale = await loader();
    if (wanted === code) active = locale; // a newer switch has already won
  } catch {
    if (wanted === code) active = undefined;
  }
}

/** Test seam: sets the active locale without loading a chunk. */
export function setDateLocaleForTests(locale: Locale | undefined): void {
  active = locale;
  wanted = locale ? "test" : "en";
}
