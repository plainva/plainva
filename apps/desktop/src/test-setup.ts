// Vitest-only setup. Locale bundles are LAZY chunks in the app (i18n.ts in
// @plainva/ui, P2.8); tests render synchronously and would otherwise see raw
// keys. This loads every bundle eagerly — never part of the production build.
// (localStorage repair for Node >= 25 lives in test-localstorage.ts, which
// runs BEFORE this file — import hoisting would defeat an inline shim here.)
import { i18nReady, loadAllLanguages } from "@plainva/ui/i18n";
import { setDateLocaleForTests } from "@plainva/ui";

await loadAllLanguages();

// The date-fns locale follows the app language, and the app language follows
// `navigator.language` — which in jsdom is the language of whoever runs the
// tests. Without this, `{{date:dddd}}` asserts "Wednesday" on an English
// machine and "Mittwoch" on a German one, and the suite would pass or fail by
// geography. So: wait for the startup load to land, then pin English.
// Tests about localisation set the locale they mean, explicitly.
await i18nReady.catch(() => {});
setDateLocaleForTests(undefined);
