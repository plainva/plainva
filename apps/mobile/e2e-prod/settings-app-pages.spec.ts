import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * The APP settings pages on the phone after the settings plan of 2026-10-29
 * (appendix 2.1-2.6): the same groups as the desktop, the explanations behind
 * the info buttons, the place stamp under Editor & notes › Journal, the logo
 * and its hint only on About & diagnostics. Against the production bundle,
 * because the info sheet is the shell's (registered in its platform services).
 */
const labels = (page: Page) => page.locator(".m-settings .pv-grouplabel");

async function shoot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  // The screen scrolls inside the app, not the document: one image at the top, one at the end.
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

test("the APP pages carry the desktop's groups, with the explanations behind the info buttons", async ({ context, page }, testInfo) => {
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
    // The APP section says once that its settings stay on this device.
    await page.getByRole("button", { name: "More about App" }).click();
    await expect(page.getByTestId("grouplabel-info-sheet")).toContainText("do not travel to your other devices");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("grouplabel-info-sheet")).toHaveCount(0);

    // Appearance: five groups, no place stamp, no logo.
    await page.locator('[data-testid="settings-area-appearance"]').click();
    await expect(labels(page)).toHaveText(["Design", "Fonts", "Language & region", "Display", "Links & tags"]);
    await expect(page.getByTestId("place-stamp-switch")).toHaveCount(0);
    await expect(page.getByText(/logo likes attention/)).toHaveCount(0);
    await expect(page.getByText("From 1024 px wide (tablet).")).toBeVisible();
    await page.getByRole("button", { name: "More about Colour tags" }).click();
    await expect(page.getByTestId("grouprow-info-sheet")).toContainText("nested tags share the colour");
    await page.keyboard.press("Escape");
    await shoot(page, testInfo, "m-appearance");
    await back();

    // Editor & notes: View, Writing, Journal with the place stamp.
    await page.locator('[data-testid="settings-area-editor"]').click();
    await expect(labels(page)).toHaveText(["View", "Writing", "Journal"]);
    await expect(page.getByTestId("place-stamp-switch")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Ask before creating empty links" })).toBeVisible();
    await shoot(page, testInfo, "m-editor");
    await back();

    // Startup & behavior: Widgets before Hints, the widget note behind its ⓘ.
    await page.locator('[data-testid="settings-area-behavior"]').click();
    await expect(labels(page)).toHaveText(["Widgets", "Hints"]);
    await shoot(page, testInfo, "m-behavior");
    await back();

    // About & diagnostics: the logo and its hint live here alone.
    await page.locator('[data-testid="settings-area-about"]').click();
    await expect(page.getByText("Plainva", { exact: true })).toBeVisible();
    await expect(page.locator(".m-settings .m-hint").first()).toContainText("logo");
    await shoot(page, testInfo, "m-about");
  } finally {
    await sql.close();
  }
});
