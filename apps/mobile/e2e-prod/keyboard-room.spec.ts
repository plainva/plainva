import { test, expect, type Page } from "./clockedTest";
import { type MobileTestGlobals, waitForVaultDirectory } from "./exampleVault";

/**
 * What a page keeps free with the keyboard up (F71 of release 0.9.0, review point 5). The keyboard hides the floating
 * bar, and the strip a page reserved for it is free since then — but a selection bar floats where the hidden bar's
 * edge was. While several notes are selected and the search field has the keyboard, the last rows of the list must
 * still be scrolled out from under the selection bar. The keyboard is the app's own state (`is-keyboard-open`, set by
 * the Keyboard plugin a browser lacks) and the smaller visible area the native resize leaves, on an iPhone's 375 × 812.
 */
const KEYBOARD = 336;

async function startWithNotes(page: Page, count: number): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (count) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (let n = 1; n <= count; n++) {
      const name = `Note ${String(n).padStart(2, "0")}`;
      await fs.writeFile({ path: `vault/${name}.md`, data: `# ${name}\n`, directory: "DATA" as never, encoding: "utf8" as never });
    }
  }, count);
  await page.reload();
  await expect(page.locator(".m-swipe-front").filter({ hasText: "Note 01" }).first()).toBeVisible({ timeout: 30_000 });
}

test("with the keyboard up and several notes selected, the last row comes out from under the selection bar", async ({ page }) => {
  test.setTimeout(120_000);
  await startWithNotes(page, 30);
  const row = page.locator(".m-swipe-front").filter({ hasText: "Note 01" }).first().getByRole("button").first();
  await row.hover();
  await row.dispatchEvent("contextmenu");
  await page.locator(".m-sheet").getByTestId("sheet-select-many").click();
  const bar = page.locator(".m-selectbar");
  await expect(bar).toBeVisible();

  await page.evaluate(() => document.querySelector(".m-app")?.classList.add("is-keyboard-open"));
  await page.setViewportSize({ width: 375, height: 812 - KEYBOARD });
  await page.waitForTimeout(300);
  // While selecting, a row belongs to the selection and is no swipe row: the notes are found by their titles.
  const last = page.getByText(/^Note \d\d$/).last();
  // To the end of the list, as far as it scrolls.
  await last.evaluate((el) => {
    let box: HTMLElement | null = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    (box ?? document.scrollingElement as HTMLElement).scrollTop = 1e6;
  });
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => {
    const titles = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && /^Note \d\d$/.test(el.textContent ?? ""));
    const row = (titles[titles.length - 1] as HTMLElement).closest("button, [role='button'], li") ?? titles[titles.length - 1]!;
    const bar = document.querySelector(".m-selectbar")!.getBoundingClientRect();
    return { rows: titles.length, rowBottom: row.getBoundingClientRect().bottom, barTop: bar.top, barBottom: bar.bottom, viewport: innerHeight };
  });
  expect(placed.rows, "the list is longer than the screen").toBeGreaterThanOrEqual(20);
  expect(placed.barBottom, "the selection bar stays on the screen").toBeLessThanOrEqual(placed.viewport);
  expect(placed.rowBottom, "the last row ends above the selection bar").toBeLessThanOrEqual(placed.barTop + 1);
});
