import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * The search over all settings on the phone (settings plan 2026-10-29, § 4.3,
 * E2): the field above the area list; a hit is a row, page › card; a tap opens
 * its screen, scrolls to the row and lights it up. The overview shows a state
 * for every service area (E15). The desktop runs the same in
 * `apps/desktop/e2e/smoke.spec.ts` ("settings search").
 */

async function shoot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
    await page.screenshot({ path: testInfo.outputPath(`${name}-${mode}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

test("the settings search on the phone lands on a row; the overview shows states", async ({ context, page }, testInfo) => {
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
    // E15: a state where a description was - no account carries the calendar, mail or anything.
    await expect(page.getByTestId("settings-area-cloudAccounts")).toContainText("Off");
    await expect(page.getByTestId("settings-area-pim")).toContainText("Off");
    await expect(page.getByTestId("settings-area-mail")).toContainText("Off");
    await expect(page.getByTestId("settings-area-security")).toContainText("Off");
    await shoot(page, testInfo, "m-settings-overview-states");

    const field = page.getByTestId("settings-search");
    await expect(field).toHaveAttribute("placeholder", "Search settings");
    await field.fill("week");
    const hits = page.getByTestId("settings-search-hit");
    await expect(hits.first()).toContainText("Week starts on");
    await expect(hits.first()).toContainText("Appearance › Language & region");
    // The area list gives way to the hits.
    await expect(page.getByTestId("settings-area-maintenance")).toHaveCount(0);
    await shoot(page, testInfo, "m-search-hits");

    await hits.first().click();
    await expect(page.locator("[data-setting-found]")).toContainText("Week starts on");
    await expect(page.locator("[data-setting-found]")).toBeInViewport();
    await shoot(page, testInfo, "m-search-landed");

    // Back returns to the same hits.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page.getByTestId("settings-search")).toHaveValue("week");
    await expect(page.getByTestId("settings-search-hit").first()).toContainText("Week starts on");

    // A synonym finds the mode; nothing found says so.
    await page.getByTestId("settings-search").fill("dark mode");
    await expect(page.getByTestId("settings-search-hit").first()).toContainText("Mode");
    await page.getByTestId("settings-search").fill("zzqqxx");
    await expect(page.getByText("No setting found.")).toBeVisible();
  } finally {
    await sql.close();
  }
});
