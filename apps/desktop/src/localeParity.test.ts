import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_LANGUAGES, DEFAULT_LANGUAGE, getLatestWhatsNew } from "@plainva/ui";

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

const SRC = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(SRC, "../../../packages/ui/src/locales");
// t() usage lives in the desktop app, the shared UI package AND the phone.
// The phone was missing here until S43, and it cost exactly what you would
// expect: 1054 keys nobody checked, fifteen of which did not exist and rendered
// their German `defaultValue` in all ten languages — eleven of those the
// accessible names of the editor toolbar, which is what a screen reader speaks.
// The locale files are shared, so the guard has to cover every shell that reads
// them.
const SCAN_ROOTS = [SRC, join(SRC, "../../../packages/ui/src"), join(SRC, "../../mobile/src")];
// Reachability needs one root more than t() usage does: core declares i18n key
// prefixes as DATA (an import source's `guideKey`), so a key can be perfectly
// alive without any shell naming it.
const KEY_LITERAL_ROOTS = [...SCAN_ROOTS, join(SRC, "../../../packages/core/src")];

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
  for (const root of SCAN_ROOTS) {
    for (const file of collectSourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(re)) keys.add(m[1]);
    }
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

/**
 * Keys built at runtime. Two shapes exist and both have to be recognised, or the
 * unreachable check turns into a machine for deleting live strings:
 *
 *   t(`import.sources.${id}`)          — literal PREFIX, variable tail
 *   t(`${needs.guideKey}.step1`)       — variable head, literal SUFFIX
 *
 * Both are derived from the source rather than hard-coded, so a new dynamic
 * family needs no edit here and nobody has to remember that its keys look dead.
 */
function dynamicKeyShapes(text: string): { prefixes: string[]; suffixes: string[] } {
  const prefixes = new Set<string>();
  const suffixes = new Set<string>();
  for (const m of text.matchAll(/\bt\(\s*`([^`]*\$\{[^`]*)`/g)) {
    const lit = m[1];
    const head = lit.split("${")[0];
    if (head && /[.\u005f]/.test(head) && /^[a-zA-Z]/.test(head)) prefixes.add(head);
    const tail = lit.slice(lit.lastIndexOf("}") + 1);
    if (tail.startsWith(".") && /^[.a-zA-Z0-9_]+$/.test(tail)) suffixes.add(tail);
  }
  return { prefixes: [...prefixes], suffixes: [...suffixes] };
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

  // The other direction: words for screens that no longer exist. Two features
  // were deleted and their text stayed — the per-provider sync forms the cloud
  // accounts wizard replaced, and the content-encryption system removed as dead
  // code — leaving 234 keys, better than two thousand strings across ten
  // languages, that every future translation pass would have carried. A key
  // reached only at runtime (t(`ns.${id}`)) counts as used; everything else has
  // to appear literally somewhere, or it is not a string the app can show.
  // 20 s, not the 5 s default: this one walks BOTH source trees and every
  // locale, which takes ~4 s alone and past 6 s when the four packages' suites
  // run at once — so under `turbo run test` it failed for the clock rather
  // than for a key (N9.4).
  it("no locale key is unreachable", { timeout: 20_000 }, () => {
    const sources = KEY_LITERAL_ROOTS.flatMap((r) => collectSourceFiles(r)).map((f) => readFileSync(f, "utf8"));
    const text = sources.join("\n");
    const { prefixes, suffixes } = dynamicKeyShapes(text);
    expect(prefixes.length).toBeGreaterThan(10); // sanity: the scan sees the runtime families
    expect(suffixes.length).toBeGreaterThan(0);

    const unreachable = [...referenceBases]
      .filter((k) => !text.includes(k))
      .filter((k) => !prefixes.some((p) => k.startsWith(p)))
      // A literal suffix only counts when the parent path is itself named in the
      // source — otherwise ".label" would excuse every orphan ending in .label.
      .filter((k) => !suffixes.some((sfx) => k.endsWith(sfx) && text.includes(k.slice(0, -sfx.length))))
      .sort();
    expect(unreachable).toEqual([]);
  });

  // The release highlights are the one place where a NUMBER in code and TEXTS in
  // i18n have to be changed together: the catalog says how many bullets a release
  // has, and both dialogs render `highlight1..N` from it. Get that pair wrong and
  // the dialog silently drops a bullet (count too low) or shows an empty one
  // (count too high) — in whichever languages were forgotten. The keys are flat,
  // not versioned, so this can only ever describe the newest catalog entry.
  it("the newest release catalog entry has exactly its highlights in every locale", () => {
    const { highlights } = getLatestWhatsNew();
    const count = highlights.length;
    expect(count).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const [lang, flat] of locales) {
      for (let i = 1; i <= count; i++) {
        // Each highlight is a PAIR: a headline and one sentence. A missing
        // headline would leave a card with a description and no name.
        for (const key of [`whatsNew.highlight${i}Title`, `whatsNew.highlight${i}`]) {
          const value = flat.get(key);
          if (typeof value !== "string" || value.trim() === "") {
            problems.push(`${lang}: ${key} missing or empty`);
          }
        }
      }
      // One past the end must NOT exist, or a release left a stale bullet behind
      // that no dialog will ever show.
      for (const key of [`whatsNew.highlight${count + 1}`, `whatsNew.highlight${count + 1}Title`]) {
        if (flat.has(key)) {
          problems.push(`${lang}: ${key} is stale (catalog says ${count})`);
        }
      }
    }
    expect(problems.sort()).toEqual([]);
  });
});

/**
 * D8 (2026-08-20): guard against a string that carries the ENGLISH text into
 * every locale file.
 *
 * The key exists everywhere, so localeParity above is happy and i18next serves
 * it without a fallback — the surface simply speaks English in nine languages
 * and nothing says so. That is how 33 `workspaceSecurity.*` strings (whole
 * sentences among them: "Vault opened. Choose the action again to continue.")
 * shipped untranslated: the security area is the one place where a reader who
 * does not speak English is asked to decide about keys and access.
 *
 * The signal is NOT "identical to English" — that describes every product name
 * and every loanword. It is "identical in nearly every language, while at least
 * one language DID translate it": a string one locale rendered is by definition
 * renderable, so the others forgot rather than decided. Deliberately no length
 * filter (short labels like "Manage" and "Access" were part of the defect).
 *
 * The list below freezes what is legitimate today — mostly cases where only
 * ja/zh translate and the Latin-script languages keep the loanword ("Bucket",
 * "Endpoint", "Agenda"), plus product names. It only ever shrinks; a new entry
 * needs a reason in the same commit.
 */
const VERBATIM_THRESHOLD = 6;

const VERBATIM_ALLOWED = new Set<string>([
  // Two placeholders and a separator; there is no word in it to translate.
  "background.trayNextInVault",
  "cloudAccounts.familyAol",
  "cloudAccounts.familyApple",
  "cloudAccounts.familyDropbox",
  "cloudAccounts.familyFastmail",
  "cloudAccounts.familyGoogle",
  "cloudAccounts.familyKoofr",
  "cloudAccounts.familyMailboxorg",
  "cloudAccounts.familyMailru",
  "cloudAccounts.familyMicrosoft",
  "cloudAccounts.familyNextcloud",
  "cloudAccounts.familyPcloud",
  "cloudAccounts.familyWebdav",
  "cloudAccounts.familyYahoo",
  "cloudAccounts.familyYandex",
  "cloudAccounts.familyZoho",
  "colorPicker.apply",
  "common.ok",
  "database.dateFormatIso",
  "database.tag",
  "editor.calloutBug",
  "editor.calloutInfo",
  "editor.slashEmoji",
  "editor.slashSecCallouts",
  "editor.tagCount",
  "emojiPicker.modeEmoji",
  "fileTree.groupVault",
  "graph.connectTitle",
  "import.formats.evernote",
  "import.formats.google_keep",
  "import.formats.simplenote",
  "import.sources.evernote",
  "import.sources.google_keep",
  "import.sources.logseq",
  "import.sources.notion_api",
  "import.sources.notion_file",
  "import.sources.obsidian",
  "import.sources.simplenote",
  "mail.captureWithEml",
  "mail.cc",
  "mail.reportJunk",
  "mobile.s3AccessKeyId",
  "mobile.s3Bucket",
  "mobile.s3Endpoint",
  "mobile.s3SecretAccessKey",
  "pim.blockLengthMinutes",
  "pim.viewAgenda",
  "properties.type_url",
  "search.opPath",
  "search.opTag",
  "settings.providerDrive",
  "settings.providerDropbox",
  "settings.providerOneDrive",
  "settings.providerWebDav",
  "settings.s3AccessKeyId",
  "settings.s3Bucket",
  "settings.s3Endpoint",
  "settings.s3SecretAccessKey",
  "settings.sectionApp",
  "settings.sectionVault",
  "settings.storedAccessVault",
  "shortcuts.modCtrl",
  "shortcuts.noteFoldMac",
  "sync.syncingCount",
  "themes.names.catppuccin",
  "themes.names.gruvbox",
  "themes.names.lcars",
  "themes.names.nord",
  "themes.names.solarized",
  "themes.variants.darmok",
  "themes.variants.make-it-so",
  "themes.variants.qapla",
  "themes.variants.resistance",
  "themes.variants.space-frontier",
  "themes.variants.tea",
  // "Tag" is the app's own established term in de/fr/nl/pt-BR and the singular of
  // pl "Tagi" - the slice rule field names the same thing the sidebar already
  // calls a tag, so translating it here would invent a second word for one idea.
  "workspaceSecurity.ruleField.tag",
  "workspaceSecurity.slice",
  "workspaceSecurity.slices",
// count: 78
]);

describe("verbatim English carry-over (D8)", () => {
  const flattenValues = (obj: unknown, prefix = ""): Array<[string, string]> => {
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      value && typeof value === "object"
        ? flattenValues(value, `${prefix}${key}.`)
        : typeof value === "string"
          ? ([[`${prefix}${key}`, value]] as Array<[string, string]>)
          : []
    );
  };

  const readLocale = (lang: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), "utf8"));

  const others = APP_LANGUAGES.map((l) => l.code).filter((code) => code !== DEFAULT_LANGUAGE);

  /** How many of the other languages leave `key` byte-identical to English. */
  const countVerbatim = (): Map<string, number> => {
    const english = flattenValues(readLocale(DEFAULT_LANGUAGE));
    const counts = new Map<string, number>();
    for (const lang of others) {
      const flat = new Map(flattenValues(readLocale(lang)));
      for (const [key, value] of english) {
        if (flat.get(key) === value) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  };

  it("no new string is carried over untranslated into nearly every language", () => {
    const offenders = [...countVerbatim()]
      .filter(([key, n]) => n >= VERBATIM_THRESHOLD && !VERBATIM_ALLOWED.has(key))
      .map(([key, n]) => `${key} (${n}/${others.length} verbatim)`);
    expect(offenders.sort()).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const counts = countVerbatim();
    const stale = [...VERBATIM_ALLOWED].filter((key) => (counts.get(key) ?? 0) < VERBATIM_THRESHOLD);
    expect(stale.sort()).toEqual([]);
  });
});
