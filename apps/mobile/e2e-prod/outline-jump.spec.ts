import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A heading picked in the outline starts the page (TestFlight feedback,
 * October 2026, iPhone): the jump scrolled as little as it could, so a
 * heading further down stopped at the bottom edge with its text out of
 * sight. Now it stands at the top of the reader, below the floating bar —
 * going down the note and coming back up.
 */
const NOTE = "# Long outline\n\n" + Array.from({ length: 60 }, (_, i) =>
  `## Section ${i}\n\nParagraph ${i} with readable content and a second sentence that wraps on a phone.`).join("\n\n");

async function jumpTo(page: Page, heading: string) {
  // After a jump down the bar has stepped aside, as it does while reading;
  // a nudge upwards brings it back, as a reader's would.
  await page.locator(".m-editor .cm-scroller").evaluate((el) => { el.scrollTop -= 1; });
  await expect(page.locator(".m-note-chrome")).not.toHaveClass(/is-away/);
  await page.getByTestId("note-context").click();
  const sheet = page.locator(".m-sheet").last();
  await sheet.getByText("Outline", { exact: true }).click();
  await sheet.locator("button.m-row").filter({ hasText: new RegExp(`^${heading}$`) }).click();
  await expect(page.locator(".m-sheet")).toHaveCount(0);
}

/** Where the heading's line stands: its top, the scroller's top, and the bar's bottom while it shows. */
async function placeOf(page: Page, heading: string) {
  return page.evaluate((text) => {
    const scroller = document.querySelector(".m-editor .cm-scroller")!.getBoundingClientRect();
    const line = [...document.querySelectorAll(".m-editor .cm-line")].find((el) => el.textContent?.trim() === text);
    const chrome = document.querySelector(".m-note-chrome");
    const shown = chrome && !chrome.classList.contains("is-away") ? chrome.getBoundingClientRect().bottom : scroller.top;
    if (!line) return null;
    // The heading's text, not its line box: the room above a heading is padding.
    const range = document.createRange();
    range.selectNodeContents(line);
    return { top: range.getBoundingClientRect().top, scrollerTop: scroller.top, scrollerHeight: scroller.height, chromeBottom: shown };
  }, heading);
}

test("an outline jump puts the heading at the top of the reader, below the bar, down the note and back up", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async (data) => (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Long outline.md", data, directory: "DATA", encoding: "utf8", recursive: true }), NOTE);
    await page.reload(); await page.locator(".m-swipe-front").filter({ has: page.getByText("Long outline", { exact: true }) }).first().click();
    await expect(page.getByTestId("note-context")).toBeVisible();

    for (const heading of ["Section 40", "Section 5"]) {
      await jumpTo(page, heading);
      await expect.poll(() => placeOf(page, heading)).not.toBeNull();
      // Settled: the bar may come back on the way up, and CodeMirror refines heights as lines mount.
      await page.waitForTimeout(400);
      const place = (await placeOf(page, heading))!;
      // Below whatever covers the top of the reader…
      expect(place.top, heading).toBeGreaterThanOrEqual(place.chromeBottom - 1);
      // …and at the top of the page, not at its bottom edge.
      expect(place.top - place.scrollerTop, heading).toBeLessThan(place.scrollerHeight * 0.25);
      if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath(`outline-${heading.replace(/\s/g, "-")}.png`) });
    }
  } finally { sql.close(); }
});
