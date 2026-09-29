import { describe, it, expect } from "vitest";
import { defaultImportRegistry } from "@plainva/core";
import { sourceTexts } from "./test-sourceTree";

/**
 * Import options declared in core must have a label in every language.
 *
 * The wizard renders whatever an adapter declares, and it builds the key at
 * runtime (`import.options.${key}`). The general locale guard scans literal
 * `t("…")` calls and therefore cannot see these: a new adapter option would
 * ship a raw key like "import.options.keepColours" into the user's window, in
 * ten languages, with every test green. This pins the pair instead — the
 * declaration in core and the texts in i18n only ever change together.
 */

const LOCALES_DIR = "packages/ui/src/locales";

let bundles: Array<[string, Record<string, any>]> | undefined;
/** Every locale bundle, read and parsed once for both checks, from the scan guards' shared snapshot. */
function locales(): Array<[string, Record<string, any>]> {
  bundles ??= sourceTexts([LOCALES_DIR], "json")
    .map(({ rel, text }) => [rel.slice(LOCALES_DIR.length + 1), text] as const)
    .filter(([name]) => !name.includes("/"))
    .map(([name, text]): [string, Record<string, any>] => [name.replace(/\.json$/, ""), JSON.parse(text)]);
  return bundles;
}

describe("import option labels", () => {
  const declared = [
    ...new Set(defaultImportRegistry.list().flatMap((s) => (s.options ?? []).map((o) => o.key))),
  ].sort();

  it("has a label and a hint for every declared option, in every language", () => {
    expect(declared.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const [lang, json] of locales()) {
      for (const key of declared) {
        if (typeof json.import?.options?.[key] !== "string") missing.push(`${lang}: options.${key}`);
        if (typeof json.import?.optionHints?.[key] !== "string") missing.push(`${lang}: optionHints.${key}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it("carries no labels for options no source offers", () => {
    // A leftover label is how a removed option quietly stays in the catalogue.
    const stale: string[] = [];
    for (const [lang, json] of locales()) {
      for (const key of Object.keys(json.import?.options ?? {})) {
        if (!declared.includes(key as never)) stale.push(`${lang}: options.${key}`);
      }
    }
    expect(stale.sort()).toEqual([]);
  });
});
