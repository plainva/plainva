import { describe, expect, it } from "vitest";
import { sourceFile, sourceTexts, type SourceText } from "./test-sourceTree";

/**
 * The empty-state duty, on the desktop (S18).
 *
 * It came back from the mobile redesign as a promise ("Leerzustands-Pflicht
 * auch am Desktop") and stayed a promise for five weeks. Two clauses, both
 * mechanically checkable, both born from a real defect:
 *
 *  1. An empty state never denies that a shipped feature exists. Mobile said
 *     "coming in a later step" about search, databases and sync — all three
 *     shipped; what was missing was the index.
 *  2. An error is not "there is nothing here". Seven desktop surfaces caught a
 *     failed query, set the list to `[]` and rendered the same sentence they
 *     show for an empty vault. The two facts are opposites and read identically
 *     — the databases list even OFFERED to create one.
 *
 * And the third, from the same family: a state whose surface can be filled from
 * where it stands offers that one action. The `.base` views carried five copies
 * of a bare sentence while "+ Eintrag" sat two rows above them.
 *
 * This reads SOURCE on purpose. A test with mocked query services would assert
 * against its own mocks; what matters here is that the catch and the render
 * agree in the file a later change would touch.
 */

const SRC = "apps/desktop/src";
const LOCALES = "packages/ui/src/locales";
const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"];

// Files are read once, the components from the scan guards' shared snapshot
// (test-sourceTree.ts): walking and reading them from disk took this guard past
// the unit-test limit under load (2026-08-24; Befunde 2026-09-24, Z2).
const read = (...parts: string[]) => sourceFile([SRC, ...parts].join("/"));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let shipped: readonly SourceText[] | undefined;
/** The shipped sources under a folder of the desktop's src, by path inside src. */
function sourcesUnder(folder: string): SourceText[] {
  shipped ??= sourceTexts([SRC], "shipped");
  return shipped
    .filter((f) => f.rel.startsWith(`${SRC}/${folder}/`))
    .map((f) => ({ rel: f.rel.slice(SRC.length + 1), text: f.text }));
}

describe("an empty state never denies a shipped feature", () => {
  it("carries no promise of a later step", () => {
    // The wording is the tell: "coming", "folgt", "später", "soon". A feature
    // that ships and a surface that says it does not yet exist cannot both be
    // right, and the surface is the one the user believes.
    const promise = /coming soon|folgt in einem|in einem sp(ä|ae)teren Schritt|noch nicht verf(ü|ue)gbar|will be available/i;
    const offenders: string[] = [];
    for (const { rel, text: source } of [...sourcesUnder("components"), { rel: "App.tsx", text: read("App.tsx") }]) {
      const text = stripComments(source);
      if (promise.test(text)) offenders.push(rel);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("an error is not \"there is nothing here\"", () => {
  /**
   * Each entry is a surface where a swallowed failure used to render the empty
   * sentence. The pairing is what the guard holds: the catch keeps a reason,
   * and the render has a branch for it BEFORE the empty one. Remove either half
   * and the surface goes back to lying quietly.
   */
  const SURFACES: Array<[parts: string[], testId: string]> = [
    [["components", "BacklinksPanel.tsx"], "backlinks-error"],
    [["components", "DatabasesList.tsx"], "databases-error"],
    [["components", "BasePicker.tsx"], "basepicker-error"],
    [["components", "base", "NewItemButton.tsx"], "templates-error"],
    [["components", "tasks", "TasksView.tsx"], "promote-bases-error"],
    [["components", "pimcal", "CalendarView.tsx"], "calendar-tasks-error"],
  ];

  for (const [parts, testId] of SURFACES) {
    it(`${parts[parts.length - 1]} says it could not look`, () => {
      const text = stripComments(read(...parts));
      expect(text, `${parts.join("/")} has no error branch`).toMatch(new RegExp(`data-testid="${testId}"`));
      // The reason comes from the shared reader, not from `.message` — a Tauri
      // error arrives as a STRING and `.message` on it renders as nothing
      // (issue #46 round, `errorText`).
      expect(text, `${parts.join("/")} does not read the error`).toMatch(/errorText\(/);
      expect(text, `${parts.join("/")} has no sentence`).toMatch(/common\.loadFailed/);
    });
  }

  it("keeps one sentence for it, in every language", () => {
    for (const lang of LANGS) {
      const dict = JSON.parse(sourceFile(`${LOCALES}/${lang}.json`)) as Record<string, Record<string, string>>;
      expect(dict.common.loadFailed, `${lang} lacks common.loadFailed`).toBeTruthy();
      // Without the placeholder the sentence is a shrug: "could not be loaded"
      // and nothing about why.
      expect(dict.common.loadFailed, `${lang} drops the reason`).toContain("{{message}}");
    }
  });
});

describe("an empty view offers the action its surface can keep", () => {
  it("defines the .base empty state once, with the create action", () => {
    const viewer = stripComments(read("components", "BaseViewer.tsx"));
    expect(viewer).toMatch(/data-testid="base-empty-new"/);
    expect(viewer).toMatch(/database\.emptyView/);
    // The action must reach the same creation path as the toolbar button —
    // a second way to make an entry would drift from the first.
    expect(viewer).toMatch(/createNewItem\(null\)/);
  });

  it("keeps no second copy of that sentence in the views", () => {
    // Five views each had their own bare EmptyState. One definition means a
    // later change (an icon, a wording, the action) lands everywhere at once.
    const strays: string[] = [];
    for (const { rel, text } of sourcesUnder("components/base")) {
      if (/database\.emptyView/.test(stripComments(text))) strays.push(rel);
    }
    expect(strays, strays.join("\n")).toEqual([]);
  });

  it("leaves the table its own row on purpose", () => {
    // The header line IS the schema: with no entries, reading the columns is
    // worth more than a button sitting above an empty grid. Named here so the
    // exception stays a decision instead of becoming an oversight.
    expect(stripComments(read("components", "base", "BaseTableView.tsx"))).toMatch(/database\.noMatchingFiles/);
  });
});
