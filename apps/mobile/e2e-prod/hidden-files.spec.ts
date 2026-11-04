import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Dot files and dot folders (decision E8, Sammelplan § 3.121): `.notizen.md`
 * and `.attachments/` belong to the vault — the index holds them, so the sync
 * carries their changes — but no surface shows them, as in Obsidian. Before
 * E8 the phone's search found them in the app's storage and not in a picked
 * folder. A link that names one still leads to it.
 */
const FILES: Array<[string, string]> = [
  ["vault/Zettel.md", "# Zettel\n\nquokka in a visible note. See [[.notizen]].\n"],
  ["vault/.notizen.md", "# Notizen\n\nquokka in a dot file.\n"],
  ["vault/.attachments/Scan.md", "# Scan\n\nquokka in a dot folder.\n"],
];

test("dot files are found by no search and listed nowhere, and a link to one still opens it", async ({ page, context }) => {
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
    await expect(page.locator(".m-swipe-front").filter({ has: page.getByText("Zettel", { exact: true }) }).first()).toBeVisible({ timeout: 20_000 });
    // The file list shows neither the dot file nor the dot folder.
    await expect(page.locator(".m-swipe-front").filter({ hasText: /notizen|attachments|Scan/ })).toHaveCount(0);

    // Search: the word is in all three files; only the visible note is a hit.
    await page.getByTestId("appbar-search").first().click();
    const field = page.getByTestId("appbar-searchpage").locator("input");
    await field.fill("quokka");
    const rows = page.locator("[data-search-occurrence]");
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Zettel");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("search-no-dot-files.png") });
    // Nor by name.
    await field.fill("Scan");
    await expect(page.getByText("Create 'Scan'", { exact: true })).toBeVisible();
    await expect(page.locator("[data-search-occurrence]")).toHaveCount(0);
    await expect(page.getByText("Scan", { exact: true })).toHaveCount(0);

    // A link to a hidden file is not a missing file: it opens.
    await field.fill("quokka");
    await rows.first().click();
    await expect(page.locator(".m-editor .cm-line", { hasText: "quokka in a visible note" })).toBeVisible();
    await page.locator(".m-editor .cm-wiki-link", { hasText: ".notizen" }).first().click();
    await expect(page.locator(".m-editor .cm-line", { hasText: "quokka in a dot file" })).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("dot-file-link-opens.png") });
  } finally {
    sql.close();
  }
});
