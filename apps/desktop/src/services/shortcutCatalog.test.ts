import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHORTCUT_CATEGORIES } from "./shortcutCatalog";

// Drift guard for the shortcuts help window (F1): every i18n key the catalog
// references must resolve to a non-empty string in the curated locales, so the
// window never shows a raw key or an empty cell. The full 10-language parity is
// enforced separately by localeParity.test.ts.

const SRC = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(SRC, "../../../../packages/ui/src/locales");

function loadLocale(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8"));
}
function resolve(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Every i18n key the catalog references, deduplicated. */
function catalogKeys(): string[] {
  const keys = new Set<string>();
  for (const cat of SHORTCUT_CATEGORIES) {
    keys.add(cat.labelKey);
    for (const r of cat.keyboard) { keys.add(r.descKey); if (r.noteKey) keys.add(r.noteKey); }
    for (const r of cat.mouse) { keys.add(r.descKey); keys.add(r.gestureKey); if (r.noteKey) keys.add(r.noteKey); }
  }
  return [...keys];
}

describe("shortcutCatalog", () => {
  it("has unique category ids", () => {
    const ids = SHORTCUT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every category holds at least one row", () => {
    for (const c of SHORTCUT_CATEGORIES) {
      expect(c.keyboard.length + c.mouse.length, `category ${c.id} is empty`).toBeGreaterThan(0);
    }
  });

  it.each(["en", "de"])("resolves every referenced i18n key in %s", (code) => {
    const locale = loadLocale(code);
    const missing = catalogKeys().filter((k) => {
      const v = resolve(locale, k);
      return typeof v !== "string" || v.length === 0;
    });
    expect(missing, `missing/empty keys in ${code}.json`).toEqual([]);
  });
});
