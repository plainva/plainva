import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * "Recent" opens a list (plan Rückmeldungen 2026-10-24, E8).
 *
 * The home screen shows the notes opened last as a band that scrolls sideways;
 * a tester needed too many swipes to reach its end. The band's heading now
 * opens every entry, newest first, under the day it was opened, and a row there
 * is the file list's row: holding it opens the same sheet, which here also
 * offers "Remove from list".
 */
test("the Recent heading opens the whole list, grouped by day and newest first", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    // Three notes were opened on earlier days; the browser's own clock dates
    // them, so "yesterday" is the app's yesterday wherever the test runs.
    await page.evaluate(async () => {
      const now = new Date();
      const day = (back: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour, 0).getTime();
      const recents = { items: [
        { path: "Projects/Beta.md", openedAt: day(1, 18) },
        { path: "Delta.md", openedAt: day(5, 9) },
        { path: "Old.md", openedAt: day(6, 9) },
      ] };
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [
        ["Projects/Beta.md", "# Beta"],
        ["Gamma.md", "# Gamma"],
        ["Delta.md", "# Delta"],
        ["Old.md", "# Old"],
        [".plainva/recents.json", JSON.stringify(recents)],
      ]) await fs.writeFile({ path: "vault/" + path, data, directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    // Open two notes today: one from the file list, one from the band.
    await page.getByRole("button", { name: /^Gamma/ }).first().click();
    await expect(page.getByRole("button", { name: /^Back$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Back$/ }).click();
    await page.locator(".m-caro-card").filter({ hasText: "Old" }).click();
    await expect(page.getByRole("button", { name: /^Back$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Back$/ }).click();

    // The band stays; its heading is the way to all of it.
    await expect(page.locator(".m-caro")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("home-bands.png") });
    await page.getByTestId("home-recent-open").click();

    const list = page.getByTestId("recent-list");
    const order = () => list.locator("[data-recent-path]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.recentPath));
    await expect.poll(order).toEqual(["Old.md", "Gamma.md", "Projects/Beta.md", "Delta.md"]);
    const labels = list.locator(".pv-grouplabel");
    await expect(labels).toHaveCount(3);
    await expect(labels.nth(0)).toHaveText("Today");
    await expect(labels.nth(1)).toHaveText("Yesterday");
    // Any other day by its weekday and date in the app language.
    await expect(labels.nth(2)).toHaveText(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}(, \d{4})?$/);
    // Each row says where the note lies and when it was opened.
    await expect(list.locator('[data-recent-path="Projects/Beta.md"]')).toContainText(/Projects · \d{1,2}:\d{2}/);

    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("recent-list.png") });

    // Holding a row opens the file list's sheet; here it can take the entry off
    // the list, and the note stays.
    await list.locator('[data-recent-path="Gamma.md"]').dispatchEvent("contextmenu");
    await expect(page.locator(".m-sheet").getByTestId("sheet-delete")).toBeVisible();
    await page.locator(".m-sheet").getByTestId("sheet-removeFromList").click();
    await expect.poll(order).toEqual(["Old.md", "Projects/Beta.md", "Delta.md"]);
    const onDisk = await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const recents = JSON.parse(String((await fs.readFile({ path: "vault/.plainva/recents.json", directory: "DATA", encoding: "utf8" })).data)) as { items: Array<{ path: string }> };
      const gamma = await fs.stat({ path: "vault/Gamma.md", directory: "DATA" }).then(() => true, () => false);
      return { paths: recents.items.map((i) => i.path), gamma };
    });
    expect(onDisk).toEqual({ paths: ["Old.md", "Projects/Beta.md", "Delta.md"], gamma: true });

    // A tap opens the note, like everywhere else.
    await list.locator('[data-recent-path="Delta.md"]').click();
    await expect(page.locator(".m-appbar")).toContainText("Delta");
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
