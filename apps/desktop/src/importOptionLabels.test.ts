import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultImportRegistry } from "@plainva/core";

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

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/src/locales");

function locales(): Array<[string, Record<string, any>]> {
  return readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"))]);
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
