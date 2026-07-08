import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_LANGUAGES, DEFAULT_LANGUAGE } from "../services/languages";

// Locale parity guard (plan Base-Erweiterungen W1/P8; generalized for N languages
// in plan Sprachen 2026-07-04): every i18n key used in the source must exist in
// EVERY locale file, and all files must carry the same key set. Without this, a
// missing key silently falls back to the inline defaultValue or the fallback
// language and the UI shows mixed languages.
//
// Plural handling: i18next resolves "key" via CLDR-suffixed variants
// ("key_one"/"key_few"/…), and languages legitimately differ in WHICH variants
// they need (zh/ja: only _other; pl: one/few/many/other). The comparison
// therefore normalizes plural suffixes to their base key; per language, at
// least the categories reported by Intl.PluralRules must be present (supersets
// are allowed, so files stay valid across ICU versions).

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(LOCALES_DIR, "..");

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
const PLURAL_RE = new RegExp(`_(${PLURAL_SUFFIXES.join("|")})$`);

function localeFiles(): string[] {
  return readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).sort();
}

function loadLocale(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"));
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { collectSourceFiles(full, out); continue; }
    if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

// Literal keys only ("ns.key…"); template-literal keys (dynamic view names) are
// intentionally not covered and must be guarded by their own tests.
function collectUsedKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /\bt\(\s*["']([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)["']/g;
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) keys.add(m[1]);
  }
  return keys;
}

function flattenKeys(obj: Record<string, unknown>, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`, out);
    else out.set(`${prefix}${k}`, String(v));
  }
  return out;
}

/** "ns.key_one" -> { base: "ns.key", plural: "one" }; non-plural keys keep base = key. */
function splitPlural(key: string): { base: string; plural: string | null } {
  const m = PLURAL_RE.exec(key);
  return m ? { base: key.slice(0, -m[0].length), plural: m[1] } : { base: key, plural: null };
}

function baseKeys(flat: Map<string, string>): Set<string> {
  return new Set([...flat.keys()].map((k) => splitPlural(k).base));
}

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]));
}

describe("locale parity", () => {
  const files = localeFiles();
  const locales = new Map(files.map((f) => [f.replace(/\.json$/, ""), flattenKeys(loadLocale(f))]));
  const reference = locales.get(DEFAULT_LANGUAGE)!;
  const referenceBases = baseKeys(reference);

  it("language registry and locale files match 1:1", () => {
    const registry = APP_LANGUAGES.map((l) => l.code).sort();
    expect([...locales.keys()].sort()).toEqual(registry);
  });

  it("all locales contain the same base key set", () => {
    for (const [lang, flat] of locales) {
      if (lang === DEFAULT_LANGUAGE) continue;
      const bases = baseKeys(flat);
      const missing = [...referenceBases].filter((k) => !bases.has(k)).sort();
      const extra = [...bases].filter((k) => !referenceBases.has(k)).sort();
      expect({ lang, missing, extra }).toEqual({ lang, missing: [], extra: [] });
    }
  });

  it("plural keys carry at least the language's plural categories", () => {
    // Plural bases = keys that exist with a suffix in the reference locale.
    const pluralBases = new Set(
      [...reference.keys()].map(splitPlural).filter((s) => s.plural).map((s) => s.base)
    );
    expect(pluralBases.size).toBeGreaterThan(0); // sanity: wizardMatches et al.
    for (const [lang, flat] of locales) {
      const required = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const missing: string[] = [];
      for (const base of pluralBases) {
        for (const category of required) {
          if (!flat.has(`${base}_${category}`)) missing.push(`${base}_${category}`);
        }
      }
      expect({ lang, missing: missing.sort() }).toEqual({ lang, missing: [] });
    }
  });

  it("interpolation placeholders match the reference locale", () => {
    // Exact keys must use exactly the reference's placeholders; extra plural
    // variants (categories the reference language lacks) must stay within the
    // union of the reference base's placeholders — "_one" may drop {{count}},
    // but no locale may invent or misspell a token.
    const unionByBase = new Map<string, Set<string>>();
    for (const [key, value] of reference) {
      const { base } = splitPlural(key);
      const set = unionByBase.get(base) ?? new Set();
      for (const p of placeholders(value)) set.add(p);
      unionByBase.set(base, set);
    }
    for (const [lang, flat] of locales) {
      if (lang === DEFAULT_LANGUAGE) continue;
      const broken: string[] = [];
      for (const [key, value] of flat) {
        const own = placeholders(value);
        const refValue = reference.get(key);
        if (refValue !== undefined) {
          const expected = placeholders(refValue);
          const same = own.size === expected.size && [...own].every((p) => expected.has(p));
          if (!same) broken.push(key);
        } else {
          const allowed = unionByBase.get(splitPlural(key).base) ?? new Set();
          if (![...own].every((p) => allowed.has(p))) broken.push(key);
        }
      }
      expect({ lang, broken: broken.sort() }).toEqual({ lang, broken: [] });
    }
  });

  it("every t() key used in src exists in every locale", () => {
    const used = collectUsedKeys();
    expect(used.size).toBeGreaterThan(50); // sanity: the scan actually found the app's keys
    const missing: string[] = [];
    for (const [lang, flat] of locales) {
      const bases = baseKeys(flat);
      for (const key of used) {
        if (!flat.has(key) && !bases.has(key)) missing.push(`${lang}: ${key}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });
});
