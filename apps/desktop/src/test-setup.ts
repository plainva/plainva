// Vitest-only setup. Locale bundles are LAZY chunks in the app (i18n.ts in
// @plainva/ui, P2.8); tests render synchronously and would otherwise see raw
// keys. This loads every bundle eagerly — never part of the production build.
// (localStorage repair for Node >= 25 lives in test-localstorage.ts, which
// runs BEFORE this file — import hoisting would defeat an inline shim here.)
//
// Only the i18n entry, never the package barrel: this file runs in front of
// every one of ~500 test files, and `@plainva/ui` loads the whole package —
// 3 s per file warm, 16 s cold, two thirds of the suite's time (Befunde
// 2026-09-24, Z2). A test that needs the package imports it itself.
import { i18nReady, loadAllLanguages, setDateLocaleForTests } from "@plainva/ui/i18n";

await loadAllLanguages();

// The date-fns locale follows the app language, and the app language follows
// `navigator.language` — which in jsdom is the language of whoever runs the
// tests. Without this, `{{date:dddd}}` asserts "Wednesday" on an English
// machine and "Mittwoch" on a German one, and the suite would pass or fail by
// geography. So: wait for the startup load to land, then pin English.
// Tests about localisation set the locale they mean, explicitly.
await i18nReady.catch(() => {});
setDateLocaleForTests(undefined);
