import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { seedExampleNote, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Every area of the phone while its first index is being built (performance
 * plan L3, second review of 11.11.).
 *
 * The reader both shells hand out refuses while the index is not whole; a
 * screen that only shows takes the view. A screen that was missed would be a
 * white surface a person finds — so the index's writes are held here, the build
 * stays under way, and every area is opened: none may fall to its boundary,
 * and no refusal may reach the console.
 */
test("every area shows while the first index is being built", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const sql = await installSqlBridge(context, { holdIndexWrites: true });
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  const refusals: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/IndexNotWholeError|INDEX_NOT_WHOLE|still being built/.test(text)) refusals.push(text);
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    // A vault with notes: the hold catches the index's first row, so an empty
    // vault's build would be over before anything is looked at.
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [
        ["vault/Projects/Plan.md", "# Plan\n\n- [ ] Call the roofer\n\nSee [[Ideas]].\n"],
        ["vault/Ideas.md", "# Ideas\n\n#garden\n"],
      ]) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true } as never);
    });
    await seedExampleNote(page);
    const close = page.getByTestId("whats-new-close");
    if (await close.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false)) await close.click();
    await expect(page.getByTestId("index-build-notice")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("tab-areas").click();
    const sheet = page.getByTestId("areas-sheet");
    await expect(sheet).toBeVisible();
    const areas = await sheet.locator('[data-testid^="areas-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")!).filter((id) => id !== "areas-sheet" && id !== "areas-arrange" && id !== "areas-ai-waiting"));
    expect(areas.length).toBeGreaterThan(4);
    for (const area of areas) {
      await test.step(area, async () => {
        // The sheet is open for the first area (it was read from it); a pick closes it.
        if (!(await sheet.isVisible())) await page.getByTestId("tab-areas").click({ timeout: 10_000 });
        await expect(sheet).toBeVisible();
        await sheet.getByTestId(area).click({ timeout: 10_000 });
        await page.waitForTimeout(700);
        await expect(page.getByTestId("area-fallback"), `${area} fell to its boundary`).toHaveCount(0);
        if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath(`index-build-${area}.png`), timeout: 15_000 });
      });
    }
    // Still being built: what was looked at was the app during its first index.
    await expect(page.getByTestId("index-build-notice")).toBeVisible();
    expect(refusals).toEqual([]);

    sql.releaseIndexWrites();
    await expect(page.getByTestId("index-build-notice")).toBeHidden({ timeout: 120_000 });
  } finally {
    sql.releaseIndexWrites();
    sql.close();
  }
});
