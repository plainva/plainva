import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("phone embeds show the addressed section and block, including nested content", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const files = {
        "Embeds.md": "# Embeds\n\n![[Source#Keep]]\n\n![[Source#^item]]\n\n![[Source#Missing]]\n",
        "Source.md": "# Source\n## Keep\nIncluded 😀\n![[Nested#Details]]\n## Exclude\nHidden section\n\n- Selected item\n  continuation ^item\n- Unselected item\n",
        "Nested.md": "# Details\nNested content\n![[Nested#Details]]\n# Other\nExcluded nested content\n",
      };
      for (const [path, data] of Object.entries(files)) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await page.waitForTimeout(1500);
    const close = page.getByTestId("whats-new-close");
    if (await close.isVisible()) await close.click();
    await page.locator(".m-swipe-front").filter({ hasText: /^Embeds$/ }).first().click();
    const section = page.locator(".m-embed-card").first();
    await expect(section).toContainText("Included 😀");
    await expect(section).toContainText("Nested content");
    await expect(section).toContainText("maximum embed depth");
    await expect(section).not.toContainText("Hidden section");
    await expect(section).not.toContainText("Excluded nested content");
    const block = page.locator(".m-embed-card").nth(1);
    await expect(block).toContainText("Selected item");
    await expect(block).not.toContainText("Unselected item");
    await expect(block).not.toContainText("^item");
    await expect(page.locator(".m-embed-card").nth(2)).toContainText("was not found");
    await section.click();
    await expect(page.locator(".cm-line").filter({ hasText: /^Included/ }).first()).toBeVisible();
  } finally { sql.close(); }
});
