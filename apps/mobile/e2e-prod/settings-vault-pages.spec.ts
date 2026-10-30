import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * The VAULT settings pages on the phone after the settings plan of 2026-10-29
 * (appendix 3.6-3.9, 4): "Content & structure" is "Notes & filing" and "Daily
 * notes & journal", Maintenance carries the OKF format with "What is OKF?" as
 * its info, Backup & versioning took the ZIP archive and the restore of deleted
 * files, the bar row is named as its screen, and Security has the desktop's
 * second level. Against the production bundle, because the info sheet is the
 * shell's (registered in its platform services).
 */
const labels = (page: Page) => page.locator(".m-settings .pv-grouplabel");

async function shoot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  const blocks = page.locator(".m-settings > *");
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
    await blocks.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}-top-${mode}.png`) });
    await blocks.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}-end-${mode}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

test("the VAULT pages carry the desktop's pages and groups, with the explanations behind the info buttons", async ({ context, page }, testInfo) => {
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
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    await page.locator('[data-testid="nav-settings"]').first().click();
    // Two pages where there was one, and the bar row named as its screen.
    await expect(page.getByTestId("settings-area-content")).toContainText("Notes & filing");
    await expect(page.getByTestId("settings-area-journal")).toContainText("Daily notes & journal");
    await expect(page.getByTestId("settings-area-bars")).toContainText("Navigation bar");
    await shoot(page, testInfo, "m-settings-overview");

    await page.getByTestId("settings-area-content").click();
    await expect(labels(page)).toHaveText(["Folders", "Templates per folder", "Templates per note type", "New notes", "Databases", "Annotations"]);
    await page.getByRole("button", { name: "More about Templates per folder" }).click();
    await expect(page.getByTestId("grouplabel-info-sheet")).toContainText("Folder beats type");
    await page.keyboard.press("Escape");
    // The reviewer name stays on this device: the badge, derived (E14).
    await expect(page.getByTestId("device-only-badge").first()).toBeVisible();
    await shoot(page, testInfo, "m-notes-filing");
    await back();

    await page.getByTestId("settings-area-journal").click();
    await expect(labels(page)).toHaveText(["Daily notes", "Journal"]);
    await expect(page.getByTestId("journal-heading")).toBeVisible();
    await shoot(page, testInfo, "m-daily-journal");
    await back();

    await page.getByTestId("settings-area-maintenance").click();
    await page.getByRole("button", { name: "More about OKF format" }).click();
    await expect(page.getByTestId("grouplabel-info-sheet")).toContainText("Open Knowledge Format");
    await page.keyboard.press("Escape");
    await shoot(page, testInfo, "m-maintenance");
    await back();

    await page.getByTestId("settings-area-backup").click();
    await expect(labels(page).first()).toHaveText("ZIP backups");
    await expect(page.getByTestId("backup-deleted-files")).toBeVisible();
    await shoot(page, testInfo, "m-backup");
    await back();

    await page.getByTestId("settings-area-security").click();
    await shoot(page, testInfo, "m-security");
  } finally {
    await sql.close();
  }
});
