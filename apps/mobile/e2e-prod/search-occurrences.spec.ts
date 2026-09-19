import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("phone search pages, jumps to the selected occurrence, and restores return context", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  const text = '# Record\n\n## First\nneedle first\n\n## Second\nneedle second\n\n' + Array.from({ length: 53 }, (_, i) => `needle extra ${i}`).join('\n\n');
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async data => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Record.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, text);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByRole('button', { name: /^Search$/ }).first().click();
    const field = page.getByTestId('appbar-searchpage').locator('input');
    await field.fill('needle');
    const rows = page.locator('[data-search-occurrence]');
    await expect(rows).toHaveCount(40);
    await expect(rows.nth(1)).toContainText('Second');
    await page.getByRole('button', { name: 'Load more occurrences' }).click();
    await expect(rows).toHaveCount(55);
    await rows.nth(45).click();
    // Reading mode highlights the occurrence without opening the keyboard.
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('needle');
    await expect(page.locator('.cm-line').filter({ hasText: /^needle extra 43$/ })).toBeInViewport();
    await page.getByRole('button', { name: /^Back$/ }).first().click();
    await expect(field).toHaveValue('needle');
    await expect(rows).toHaveCount(55);
    await expect(rows.nth(45)).toBeInViewport();
    await field.fill('missingterm');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('No matching occurrences.', { exact: true })).toBeVisible();
  } finally { sql.close(); }
});

/**
 * The ORDER of the hits and of the backlinks (finding 2026-09-19).
 *
 * Search hits came by relevance and nothing else; backlinks came in whatever
 * order the link table held them, because the statement had no ORDER BY. This
 * runs against the real SQLite index: three notes that all match and all link
 * to one hub, sorted through the sheet and through the chips, and the choice
 * survives a reload.
 */
test("search hits and backlinks follow the chosen order, and the choice is remembered", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  const notes: Array<[string, string]> = [
    ["vault/Hub.md", "# Hub\n\nThe target of three notes."],
    ["vault/Zebra.md", "# Zebra\n\nquokka here, see [[Hub]]."],
    ["vault/Alpha.md", "# Alpha\n\nquokka here, see [[Hub]] and again [[Hub]]."],
    ["vault/Mango.md", "# Mango\n\nquokka here, see [[Hub]]."],
  ];
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (files) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of files) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, notes);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    const openSearch = async () => {
      // After a reload the session may come back ON the search screen.
      const field = page.getByTestId("appbar-searchpage").locator("input");
      await page.waitForTimeout(1500);
      if (!(await field.isVisible())) await page.getByRole("button", { name: /^Search$/ }).first().click();
      await field.fill("quokka");
      return field;
    };
    const titles = async () => {
      const rows = page.locator("[data-search-occurrence]");
      await expect(rows).toHaveCount(3);
      const texts = await rows.allTextContents();
      return texts.map((text) => ["Alpha", "Mango", "Zebra"].find((name) => text.includes(name)));
    };

    await openSearch();
    await page.getByTestId("search-sort").click();
    await page.getByTestId("search-sort-sheet-title").click();
    expect(await titles()).toEqual(["Alpha", "Mango", "Zebra"]);
    // The active key again flips the direction — the file tree's rule.
    await page.getByTestId("search-sort").click();
    await expect(page.getByTestId("search-sort-sheet-title")).toContainText("Ascending");
    await page.getByTestId("search-sort-sheet-title").click();
    expect(await titles()).toEqual(["Zebra", "Mango", "Alpha"]);

    // Remembered on this device.
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await openSearch();
    expect(await titles()).toEqual(["Zebra", "Mango", "Alpha"]);
    expect(await page.evaluate(() => localStorage.getItem("plainva-search-sort"))).toBe(JSON.stringify({ key: "title", dir: "desc" }));

    // Backlinks of the hub: by title, with the note's TITLE rather than its file name.
    await page.getByTestId("appbar-searchpage").locator("input").fill("target of three");
    // Wait for THIS query's list - the debounce still shows the old hits for a
    // moment, and those mention the hub too ("see [[Hub]]").
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("three notes");
    await page.locator("[data-search-occurrence]").first().click();
    await page.getByTestId("note-context").click();
    await page.getByRole("radio", { name: /Backlinks/ }).click();
    const rows = page.getByTestId("backlink-row");
    await expect(rows).toHaveCount(3);
    expect((await rows.allTextContents()).map((text) => text.replace(/×\d+/, "").trim())).toEqual(["Alpha", "Mango", "Zebra"]);
    const chips = page.getByTestId("backlinks-sort");
    await chips.getByText(/^Title/).click();
    expect((await rows.allTextContents()).map((text) => text.replace(/×\d+/, "").trim())).toEqual(["Zebra", "Mango", "Alpha"]);
    await chips.getByText(/^Number of links/).click();
    expect((await rows.allTextContents())[0]).toContain("Alpha");
  } finally { sql.close(); }
});
