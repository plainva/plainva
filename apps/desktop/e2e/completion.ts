import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Picks an entry of the editor's completion list (`/icon`, `[[…`) with a click,
 * once the list stands for what was typed (Sammelplan § 3.92 Nr. 1).
 *
 * The list is rebuilt as the result for each typed letter comes in. A test
 * clicked the entry 9 ms after the last letter (CI run 37962160661): ten
 * seconds later the list still stood open with the entry marked and nothing
 * inserted — the click had gone to a list that was being replaced. CodeMirror
 * applies a click on an entry by the entry's place in the CURRENT list, from
 * the press inside it; an entry that left the page before the press lands is
 * not chosen. So the list is waited for until nothing in it has changed for a
 * moment, and the click is made on the entry as it then stands.
 *
 * Returns the entry clicked, for a test that wants to look at it.
 */
export async function pickCompletion(page: Page, entry: string | RegExp): Promise<Locator> {
  const list = page.locator(".cm-tooltip-autocomplete");
  const option = list.locator("li", { hasText: entry }).first();
  await expect(option).toBeVisible();
  await list.first().evaluate(
    (element) =>
      new Promise<void>((settled) => {
        const QUIET_MS = 150;
        let timer = setTimeout(done, QUIET_MS);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, QUIET_MS);
        });
        observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
        // A list that never holds still is clicked as it is after two seconds.
        const cap = setTimeout(done, 2_000);
        function done() {
          clearTimeout(timer);
          clearTimeout(cap);
          observer.disconnect();
          settled();
        }
      }),
  );
  await expect(option).toBeVisible();
  await option.click();
  return option;
}
