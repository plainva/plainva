import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The version history of any file, from its row (open-items plan 3.123): the
 * desktop offers it in the context menu of every file; the phone's row sheet
 * had it for no file, and its panel showed "no preview" for an image. A
 * snapshot of a picture is drawn as a picture, from its bytes.
 */
const PNG_1PX_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("an image's row offers its version history, and a version is drawn as the picture", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (png) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      // Base64 without an encoding: the bytes of a picture, as the adapter writes them.
      for (const path of ["Pics/shot.png", ".plainva/backups/Pics/shot.png.1760000000000.bak"]) {
        await fs.writeFile({ path: "vault/" + path, data: png, directory: "DATA", recursive: true });
      }
    }, PNG_1PX_BASE64);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^Pics/ }).first().click();
    await page.getByRole("button", { name: /^shot/ }).first().dispatchEvent("contextmenu");
    await page.getByTestId("sheet-versionHistory").click();
    const sheet = page.getByTestId("file-history-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator("button.m-row").first().click();
    const img = sheet.getByTestId("version-image");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(sheet.getByTestId("version-no-preview")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("file-version-image.png") });
  } finally {
    await sql.close();
  }
});
