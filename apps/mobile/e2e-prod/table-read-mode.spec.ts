import { test, expect } from "./clockedTest";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A table in read mode (GitHub issue 118, plan Rückmeldungen 05.11., P5). On
 * Android a long press in a cell opened "Edit table" instead of selecting
 * text, and after Back the table stood there as raw Markdown. In read mode the
 * press now stays the system's: no sheet, and a selection in the table leaves
 * it rendered. While editing, the same press still opens the sheet.
 */
const NOTE = "# Preise\n\n| Ware | Preis |\n| --- | --- |\n| Brot | 3 |\n| Milch | 2 |\n\nEnde\n";

test("a long press in a table cell in read mode selects text and the table stays a table", async ({ page }) => {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (note) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    await fs.writeFile({ path: "vault/Preise.md", data: note, directory: "DATA" as never, encoding: "utf8" as never, recursive: true });
  }, NOTE);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Preise / }).first().click();

  const table = page.locator(".cm-md-table");
  const cell = table.locator("tbody td").first();
  await expect(cell).toHaveText("Brot", { timeout: 20_000 });
  await expect(page.getByTestId("note-edit")).toBeVisible();

  // The long press: the WebView fires `contextmenu` on the cell.
  const prevented = await cell.evaluate((el) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented, "the press stays with the system").toBe(false);
  // And the system selects the word: a selection inside the table.
  await cell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(500);
  await expect(page.getByText("Edit table", { exact: true })).toHaveCount(0);
  await expect(table).toHaveCount(1);
  await expect(page.locator(".cm-content")).not.toContainText("| Brot |");
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("table-read-mode-mobile.png") });

  // Positive control: while editing, the same press opens the table sheet.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByTestId("note-edit").click();
  await expect(table.locator("tbody td").first()).toHaveText("Brot");
  await table.locator("tbody td").first().dispatchEvent("contextmenu", { button: 2 });
  await expect(page.getByText("Edit table", { exact: true })).toBeVisible();
});
