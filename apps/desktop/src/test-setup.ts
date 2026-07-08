// Vitest-only setup. Locale bundles are LAZY chunks in the app (i18n.ts,
// P2.8); tests render synchronously and would otherwise see raw keys. This
// file loads every bundle eagerly — it is never part of the production build.
// (localStorage repair for Node >= 25 lives in test-localstorage.ts, which
// runs BEFORE this file — import hoisting would defeat an inline shim here.)
import i18n from "./i18n";

const localeModules = import.meta.glob("./locales/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

for (const [path, mod] of Object.entries(localeModules)) {
  const code = path.replace("./locales/", "").replace(".json", "");
  if (!i18n.hasResourceBundle(code, "translation")) {
    i18n.addResourceBundle(code, "translation", mod.default, true, true);
  }
}
