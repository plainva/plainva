import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * No folder setting on the phone points under `.plainva` or out of the vault
 * (open-items plan 3.127 no. 4). The field says why and goes back to what is
 * stored; a folder inside the vault is saved as before. The same rule as the
 * desktop's, and as both shells' settings-profile import.
 */
test("a folder setting under .plainva is refused and said; one inside the vault is kept", async ({ context, page }, testInfo) => {
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
    await page.getByTestId("settings-area-content").click();

    const field = page.getByRole("textbox", { name: "Template folder", exact: true });
    await expect(field).toBeVisible();
    const before = await field.inputValue();

    await field.fill(".plainva/Templates");
    await field.blur();
    await expect(page.locator(".pv-toast").filter({ hasText: ".plainva/Templates" })).toBeVisible();
    await expect(field).toHaveValue(before);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("m-vault-path-refused.png") });

    await field.fill("Vorlagen");
    await field.blur();
    await expect(field).toHaveValue("Vorlagen");
    // Saved: the page shows it again after a round back to the overview.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await page.getByTestId("settings-area-content").click();
    await expect(page.getByRole("textbox", { name: "Template folder", exact: true })).toHaveValue("Vorlagen");
  } finally {
    await sql.close();
  }
});
