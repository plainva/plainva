// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  findSettingElement,
  searchSettings,
  SETTINGS_EXTRA_PAGES,
  SETTINGS_SUB_LABELS,
  SETTINGS_SYNONYMS,
  settingsArea,
} from "@plainva/ui";
import { SETTINGS_SEARCH_INDEX } from "../../../packages/ui/src/lib/settingsSearchIndex";
import { REPO, sourceFile, sourceMap } from "./test-sourceTree";
import {
  extractSettingsIndex,
  renderSettingsIndex,
  SETTINGS_PRIMITIVE_PATTERN,
  SETTINGS_SOURCE_EXEMPT,
  SETTINGS_SOURCES,
} from "./test-settingsIndex";

/**
 * The search over all settings (settings plan 2026-10-29, § 4.3, E2) reads a
 * list of every row of both shells, generated from their JSX. These tests keep
 * that list true: what the pages draw is what the list holds, every file that
 * draws settings rows is read (or says why not), and every key it names exists.
 */

const INDEX_FILE = "packages/ui/src/lib/settingsSearchIndex.ts";
const LANGS = ["de", "en", "es", "fr", "it", "ja", "nl", "pl", "pt-BR", "zh-CN"];
const locales = sourceMap(["packages/ui/src/locales"], "json");
const bundle = (lang: string) => JSON.parse(locales.get(`packages/ui/src/locales/${lang}.json`)!) as Record<string, unknown>;
const lookup = (tree: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
const hasKey = (tree: Record<string, unknown>, key: string) => typeof lookup(tree, key) === "string" || typeof lookup(tree, `${key}_other`) === "string";

const de = bundle("de");
const tDe = (key: string, options?: Record<string, unknown>) => {
  const value = lookup(de, key) ?? lookup(de, `${key}_other`);
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
};

describe("settings search index", () => {
  const extraction = extractSettingsIndex();

  it("is what the settings pages of both shells draw", () => {
    const expected = renderSettingsIndex(extraction.entries);
    if (process.env.PLAINVA_WRITE_SETTINGS_INDEX === "1") writeFileSync(join(REPO, INDEX_FILE), expected, "utf8");
    expect(
      sourceFile(INDEX_FILE).replace(/\r\n/g, "\n") === expected,
      `${INDEX_FILE} is stale - a settings row was added, moved or renamed. Rewrite it: PLAINVA_WRITE_SETTINGS_INDEX=1 pnpm --filter desktop exec vitest run src/settingsSearchIndex.test.ts`,
    ).toBe(true);
    expect(SETTINGS_SEARCH_INDEX.length).toBe(extraction.entries.length);
  });

  it("reads every file that draws settings rows, or names why it does not", () => {
    const read = new Set(SETTINGS_SOURCES.map((source) => source.file));
    const missing: string[] = [];
    for (const [shell, roots] of [["desktop", ["apps/desktop/src", "packages/ui/src"]], ["mobile", ["apps/mobile/src"]]] as const) {
      for (const [rel, text] of sourceMap(roots, "shipped")) {
        if (!rel.endsWith(".tsx") || !SETTINGS_PRIMITIVE_PATTERN[shell].test(text)) continue;
        // The primitives' own file defines them; it draws no page.
        if (rel.includes("/components/ui/")) continue;
        if (!read.has(rel) && !SETTINGS_SOURCE_EXEMPT[rel]) missing.push(rel);
      }
    }
    expect(missing, `add these files to SETTINGS_SOURCES (test-settingsIndex.ts) with their page, or to SETTINGS_SOURCE_EXEMPT with the reason:\n${missing.join("\n")}`).toEqual([]);
  });

  it("keeps the lists honest: every source and exemption names a file that exists", () => {
    const all = new Set([...sourceMap(["apps/desktop/src", "apps/mobile/src", "packages/ui/src"], "shipped").keys()]);
    const stale = [...SETTINGS_SOURCES.map((source) => source.file), ...Object.keys(SETTINGS_SOURCE_EXEMPT)].filter((file) => !all.has(file));
    expect(stale).toEqual([]);
    const both = Object.keys(SETTINGS_SOURCE_EXEMPT).filter((file) => SETTINGS_SOURCES.some((source) => source.file === file));
    expect(both, "a file is read AND exempt").toEqual([]);
  });

  it("names only areas, sub-pages and locale keys that exist", () => {
    const en = bundle("en");
    const problems: string[] = [];
    for (const entry of SETTINGS_SEARCH_INDEX) {
      if (!settingsArea(entry.area) && !SETTINGS_EXTRA_PAGES[entry.area]) problems.push(`unknown area ${entry.area}`);
      if (entry.sub && !SETTINGS_SUB_LABELS[entry.sub]) problems.push(`no label for sub-page ${entry.sub}`);
      for (const key of [entry.card, entry.label, ...(entry.desc ?? []), ...(entry.info ?? [])]) {
        if (key && (!hasKey(de, key) || !hasKey(en, key))) problems.push(`${entry.area}: missing key ${key}`);
      }
    }
    for (const key of Object.values(SETTINGS_SUB_LABELS)) if (!hasKey(de, key)) problems.push(`sub label ${key}`);
    expect(problems).toEqual([]);
  });

  it("finds each row of both shells by its own label", () => {
    const misses: string[] = [];
    for (const shell of ["desktop", "mobile"] as const) {
      for (const entry of SETTINGS_SEARCH_INDEX.filter((e) => e.shell === shell && e.kind === "row" && e.label)) {
        const title = tDe(entry.label!);
        const hits = searchSettings(title, { shell, t: tDe, limit: 500 });
        if (!hits.some((hit) => hit.kind === "row" && hit.area === entry.area && hit.title === title)) misses.push(`${shell} ${entry.area}: ${title}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("finds a setting by its visible line, by the text behind its ⓘ and by a synonym", () => {
    // "Mindestens {{min}} s." stands visibly under the sync interval.
    expect(searchSettings("Mindestens", { shell: "desktop", t: tDe }).some((hit) => hit.title === tDe("settings.syncInterval"))).toBe(true);
    // "Lokale Speicherungen gehen sofort hoch." is behind the interval's ⓘ.
    expect(searchSettings("Speicherungen", { shell: "desktop", t: tDe }).some((hit) => hit.title === tDe("settings.syncInterval"))).toBe(true);
    // "Dunkelmodus" is no word of the page; it is a synonym of the mode.
    const dark = searchSettings("Dunkelmodus", { shell: "mobile", t: tDe });
    expect(dark[0]?.title).toBe(tDe("settings.themeMode"));
    expect(dark[0]?.path).toBe(`${tDe("settings.sectionAppearance")} › ${tDe("settings.groupDesign")}`);
  });

  it("ranks a label that starts with the query first, and every word must match", () => {
    const hits = searchSettings("sprache", { shell: "desktop", t: tDe });
    expect(hits[0]?.title).toBe(tDe("settings.language"));
    expect(searchSettings("sprache zzzz", { shell: "desktop", t: tDe })).toEqual([]);
    expect(searchSettings("  ", { shell: "desktop", t: tDe })).toEqual([]);
  });

  it("keeps the hits of a page hidden in this state, marked, and leaves out the vault world without a vault", () => {
    const hidden = searchSettings("Erinnerungen", { shell: "desktop", t: tDe, hiddenAreas: ["pim"] });
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.filter((hit) => hit.area === "pim").every((hit) => hit.hidden)).toBe(true);
    expect(searchSettings("Erinnerungen", { shell: "desktop", t: tDe, worlds: ["app"] }).some((hit) => hit.world === "vault")).toBe(false);
  });

  it("gives every synonym a row it belongs to and a text in all ten languages", () => {
    const labels = new Set(SETTINGS_SEARCH_INDEX.map((entry) => entry.label));
    const problems: string[] = [];
    for (const [label, key] of Object.entries(SETTINGS_SYNONYMS)) {
      if (!labels.has(label)) problems.push(`synonym for ${label}, which no row carries`);
      for (const lang of LANGS) if (typeof lookup(bundle(lang), key) !== "string") problems.push(`${lang}: ${key}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("finding the row on the page", () => {
  const page = () => {
    document.body.innerHTML = `
      <div id="page">
        <section class="pv-setgroup"><div class="pv-setgroup-label">Design <span class="pv-badge">Nur auf diesem Gerät</span></div>
          <div class="pv-setcard"><div class="pv-setrow" id="a"><div class="pv-setrow-main"><div class="pv-setrow-label">Modus<button aria-label="Mehr zu Modus"></button></div></div></div></div>
        </section>
        <section class="pv-setgroup"><div class="pv-setgroup-label">Schrift</div>
          <div class="pv-setcard"><div class="pv-setrow" id="b"><div class="pv-setrow-main"><div class="pv-setrow-label">Modus</div></div></div></div>
        </section>
        <details class="pv-setgroup"><summary class="pv-setgroup-label">Erweitert</summary>
          <div class="pv-setcard"><div class="pv-setrow" id="c"><div class="pv-setrow-main"><div class="pv-setrow-label">Dasselbe Konto</div></div></div></div>
        </details>
        <p class="pv-grouplabel">Konto</p>
        <div class="pv-card"><div class="pv-grouprow" id="d"><span class="pv-grouprow-title"><bdi>Sprache</bdi></span></div></div>
      </div>`;
    // jsdom lays nothing out: every element counts as shown unless it is in a closed <details>.
    for (const el of Array.from(document.querySelectorAll("*"))) {
      (el as HTMLElement).getClientRects = () => (el.closest("details:not([open])") && el.tagName !== "SUMMARY" && !el.closest("summary") ? [] : [{}]) as unknown as DOMRectList;
    }
    return document.getElementById("page")!;
  };

  it("takes the row under its card, without the badge or the info button in the heading", () => {
    expect(findSettingElement(page(), { title: "Modus", cardText: "Schrift" })?.id).toBe("b");
    expect(findSettingElement(page(), { title: "Modus", cardText: "Design" })?.id).toBe("a");
  });

  it("falls back to a row of that name elsewhere, finds folded rows and phone rows, and a card by its heading", () => {
    expect(findSettingElement(page(), { title: "Modus", cardText: "Gibt es nicht" })?.id).toBe("a");
    expect(findSettingElement(page(), { title: "Dasselbe Konto" })?.id).toBe("c");
    expect(findSettingElement(page(), { title: "Sprache", cardText: "Konto" })?.id).toBe("d");
    expect(findSettingElement(page(), { cardText: "Schrift" })?.className).toBe("pv-setgroup");
    expect(findSettingElement(page(), { title: "Nirgends" })).toBeNull();
  });
});
