// Vitest-only setup. Locale bundles are LAZY chunks in the app (i18n.ts in
// @plainva/ui, P2.8); tests render synchronously and would otherwise see raw
// keys. This loads every bundle eagerly — never part of the production build.
// (localStorage repair for Node >= 25 lives in test-localstorage.ts, which
// runs BEFORE this file — import hoisting would defeat an inline shim here.)
import { loadAllLanguages } from "@plainva/ui/i18n";

await loadAllLanguages();
