import { describe, it, expect, beforeAll } from "vitest";
import i18n, { loadAllLanguages } from "@plainva/ui/i18n";
import { APP_LANGUAGES } from "../../../../packages/ui/src/services/languages";

/**
 * The two outcomes of a failed delete say the OPPOSITE of each other, and they
 * used to be indistinguishable on screen — a reporter's "still get an error"
 * could not be attributed to either (issue #34, wave 4):
 *
 * - the OS trash refused, so the item was deleted permanently → it is GONE
 * - the delete itself failed → the item is STILL THERE
 *
 * Both must name the item, and neither may be phrased so vaguely that the next
 * report is as unattributable as the last. This pins that in every language:
 * translation drift is exactly how two messages quietly become one again.
 */
describe("delete outcome messages", () => {
  // `loadAllLanguages()` resolves to nothing; the bundles live in i18next. Until
  // 2026-11-10 this read its (un-awaited) promise as the bundle map, and both
  // loops below ran over an empty object - the guard checked nothing.
  const langs: Record<string, unknown> = {};
  beforeAll(async () => {
    await loadAllLanguages();
    for (const { code } of APP_LANGUAGES) langs[code] = i18n.getResourceBundle(code, "translation");
  });

  it("reads every app language (a guard that loops over nothing checks nothing)", () => {
    expect(Object.keys(langs).sort()).toEqual(APP_LANGUAGES.map((l) => l.code).sort());
    expect(APP_LANGUAGES.length).toBeGreaterThanOrEqual(10);
    for (const [lang, bundle] of Object.entries(langs)) expect(bundle, lang).toBeTruthy();
  });

  it("both outcomes exist in every language and name the item", () => {
    for (const [lang, bundle] of Object.entries(langs)) {
      const dialogs = (bundle as Record<string, Record<string, string>>).dialogs;
      const gone = dialogs?.trashUnavailableMsg;
      const stillThere = dialogs?.deleteStillThereMsg;
      expect(gone, `${lang}: trashUnavailableMsg`).toBeTruthy();
      expect(stillThere, `${lang}: deleteStillThereMsg`).toBeTruthy();
      // Without the name, the user cannot tell WHICH item the message is about
      // — the folder they clicked, or a child of it.
      expect(gone, `${lang}: trashUnavailableMsg names the item`).toContain("{{name}}");
      expect(stillThere, `${lang}: deleteStillThereMsg names the item`).toContain("{{name}}");
      // The failure carries the reason; that is what a bug report needs.
      expect(stillThere, `${lang}: deleteStillThereMsg carries the reason`).toContain("{{error}}");
    }
  });

  it("the two outcomes are not the same sentence", () => {
    for (const [lang, bundle] of Object.entries(langs)) {
      const dialogs = (bundle as Record<string, Record<string, string>>).dialogs;
      expect(dialogs.trashUnavailableMsg, `${lang}`).not.toBe(dialogs.deleteStillThereMsg);
    }
  });
});
