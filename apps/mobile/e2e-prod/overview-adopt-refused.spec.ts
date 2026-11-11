import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * An overview that cannot be adopted says why (Sammelplan § 3.135 no. 3). The
 * phone offers the adoption only in a folder without an `index.md`; when one
 * appears in between — written by another device, or by another program —
 * the vault refuses the rename. Every refused adoption read "The overview
 * could not be written.", whatever the reason; it now names the note and the
 * reason in the user's words, not the vault's English. The desktop says the
 * same in its result line (`silentUserWrites.test.ts`).
 */
const FILES: Array<[string, string]> = [
  ["vault/Projekte/MOC.md", "# Projects\n\n- [[Plan]]\n"],
  ["vault/Projekte/Plan.md", "# Plan\n\nThe plan.\n"],
];

test("an adoption the vault refuses names the note and the reason", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
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

    // An index.md arrives after the list was drawn.
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Projekte/index.md", data: "# Projekte\n\nWritten elsewhere.\n", directory: "DATA", encoding: "utf8", recursive: true });
    });
    await row.click();
    await page.getByTestId("confirm-act").click();

    const said = page.locator(".pv-toast--error", { hasText: "“MOC.md” could not become the overview: “index.md” already exists." });
    await expect(said).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".pv-toast--error", { hasText: "The overview could not be written." })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("m-overview-adopt-refused.png") });

    // Nothing was adopted: the note is where it was, the other index.md as it came.
    const files = await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const read = (path: string) => fs.readFile({ path, directory: "DATA", encoding: "utf8" }).then((r) => String(r.data), () => null);
      return { moc: await read("vault/Projekte/MOC.md"), index: await read("vault/Projekte/index.md") };
    });
    expect(files).toEqual({ moc: "# Projects\n\n- [[Plan]]\n", index: "# Projekte\n\nWritten elsewhere.\n" });
  } finally {
    sql.close();
  }
});
