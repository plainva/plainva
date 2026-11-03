import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Sammelplan § 3.135 Nr. 6, decision E10: a link that names an overview only
 * as `index` leads to whichever `index.md` the link rule finds first, and an
 * adoption took it over without a word - here a link in Projekte/ to the
 * overview of Other/ led to the adopted note afterwards. The adoption sheet
 * offers, counted, to write such links with their folder, beside the
 * preparation; the desktop's index.md manager offers the same
 * (index-adopt-pins.spec.ts).
 */
const FILES: Array<[string, string]> = [
  ["vault/Other/index.md", "# Other\n"],
  ["vault/Projekte/MOC.md", "# Projects\n\n- [[Plan]]\n"],
  ["vault/Projekte/Plan.md", "See [[index]].\n"],
];

test("adopting an overview offers to write the links to other overviews with their folder, and does", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, FILES);
    await page.reload();
    await waitForVaultDirectory(page);

    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.getByTestId("settings-area-maintenance").click();
    await page.getByTestId("open-overviews").click();
    const row = page.getByTestId("overview-row-Projekte");
    await expect(row).toContainText("Projekte");
    await row.click();

    const offer = page.getByTestId("confirm-option-also");
    await expect(offer).toBeChecked({ timeout: 15_000 });
    await expect(page.locator(".m-sheet-option").filter({ has: offer })).toContainText("Write links to other overviews with their folder, so they keep leading there (1)");
    await page.screenshot({ path: testInfo.outputPath("m-overview-adopt-pin-offer.png") });
    await page.getByTestId("confirm-act").click();

    await expect(page.locator(".pv-toast", { hasText: "Links to other overviews written with their folder: 1" })).toBeVisible({ timeout: 15_000 });
    const files = await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const read = (path: string) => fs.readFile({ path, directory: "DATA", encoding: "utf8" }).then((r) => String(r.data), () => null);
      return { plan: await read("vault/Projekte/Plan.md"), index: await read("vault/Projekte/index.md"), moc: await read("vault/Projekte/MOC.md") };
    });
    expect(files.plan).toBe("See [[Other/index]].\n");
    expect(files.index).not.toBeNull();
    expect(files.moc).toBeNull();
  } finally {
    sql.close();
  }
});
