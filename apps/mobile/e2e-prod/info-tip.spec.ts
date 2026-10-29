import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * The info button of a setting on the phone (settings plan 2026-10-29, § 3):
 * a tap on the ⓘ at the end of "Rebuild index" opens the phone's own sheet
 * with the explanation and the way into the handbook — and never the row it
 * sits in, which would start the rebuild. Against the production bundle,
 * because the sheet is the shell's (registered in its platform services) and
 * only the real start wires it.
 */
test("the info button opens a sheet, not the row, and Escape closes it", async ({ context, page }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.locator('[data-testid="settings-area-maintenance"]').click();
    const info = page.getByRole("button", { name: "More about Rebuild index" });
    await expect(info).toBeVisible();
    // The row keeps its own name: the button beside the title is not part of it.
    await expect(page.getByRole("button", { name: "Rebuild index", exact: true })).toBeVisible();

    await info.click();
    const sheet = page.getByTestId("grouprow-info-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".m-sheet-title")).toHaveText("Rebuild index");
    await expect(sheet).toContainText("The search index is Plainva's record of what your notes contain");
    await expect(sheet.getByRole("button", { name: "Read more in the handbook" })).toBeVisible();
    await expect(info).toHaveAttribute("aria-expanded", "true");
    // The tap went to the button, not to the row: no rebuild started.
    await expect(page.getByText("Search index rebuilt.")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("info-sheet-light.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("info-sheet-dark.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(info).toHaveAttribute("aria-expanded", "false");
    // Still on Maintenance: Escape closed the sheet, nothing else.
    await expect(info).toBeVisible();

    // The backdrop closes it too.
    await info.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(20, 80);
    await expect(sheet).toHaveCount(0);
  } finally {
    await sql.close();
  }
});
