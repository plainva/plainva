import { describe, it, expect } from "vitest";
import { SETTINGS_AREAS } from "@plainva/ui";
import { sourceMap } from "./test-sourceTree";
import { extractSettingsIndex } from "./test-settingsIndex";

/**
 * Visible lines in settings stay short (settings plan 2026-10-29, § 2, E8).
 *
 * The plan's rule for every explaining text: what someone needs to avoid a
 * wrong, irreversible or unnoticed decision stays visible - in one short line;
 * everything else goes behind the ⓘ. A visible line that grows past 140
 * characters in German or English is a paragraph again, and the next one
 * after it would follow. So the guard measures, in both languages, every
 * text that stands VISIBLY in the settings of both shells: a row's line
 * (`SettingRow desc`, the phone's `subtitle`, a field's `hint`), a card note
 * (`SettingCardNote`, `SettingCardBlock`), a phone hint under a card
 * (`p.m-hint`) and a page's one-line description - read from the same JSX
 * the settings search reads (`test-settingsIndex.ts`). Interpolated values
 * do not count: the template is measured.
 */

const LIMIT = 140;

/**
 * Texts allowed to be longer, each with its reason. Only states and errors
 * qualify - a text that EXPLAINS goes behind the ⓘ instead of onto this list.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "mobile.liftEncryptionRunning": "a progress state with a count, shown only while encryption is being lifted; it says what still runs and what not to do meanwhile",
};

const locales = sourceMap(["packages/ui/src/locales"], "json");
const bundle = (lang: string) => JSON.parse(locales.get(`packages/ui/src/locales/${lang}.json`)!) as Record<string, unknown>;
const lookup = (tree: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
/** A key's texts: itself, or its plural forms. */
const textsOf = (tree: Record<string, unknown>, key: string): string[] => {
  const own = lookup(tree, key);
  if (typeof own === "string") return [own];
  return ["zero", "one", "two", "few", "many", "other"].map((form) => lookup(tree, `${key}_${form}`)).filter((value): value is string => typeof value === "string");
};

describe("visible lines in settings (E8)", () => {
  const { visibleKeys } = extractSettingsIndex();
  const keys = new Map(visibleKeys);
  for (const area of SETTINGS_AREAS) keys.set(area.descKey, "settingsCatalog (page description)");

  it("reads a reasonable number of visible lines (the extraction did not go blind)", () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  it(`keeps every one at ${LIMIT} characters or fewer in German and English`, () => {
    const long: string[] = [];
    for (const lang of ["de", "en"]) {
      const tree = bundle(lang);
      for (const [key, where] of keys) {
        if (EXEMPT[key]) continue;
        for (const text of textsOf(tree, key)) {
          if (text.length > LIMIT) long.push(`${lang} ${key} (${text.length}) - ${where}`);
        }
      }
    }
    expect(long, `shorten these, or move the explanation behind the ⓘ (settings plan § 2):\n${long.join("\n")}`).toEqual([]);
  });

  it("names only keys that exist", () => {
    const de = bundle("de");
    const missing = [...keys.keys()].filter((key) => textsOf(de, key).length === 0);
    expect(missing).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const stale = Object.keys(EXEMPT).filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });
});
