import { describe, it, expect } from "vitest";
import { loadAllLanguages } from "@plainva/ui/i18n";

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
  const langs = loadAllLanguages();

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
