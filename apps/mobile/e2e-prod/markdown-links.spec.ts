import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A Markdown link leads where it leads on the desktop (ADR 0027, addendum
 * 2026-10-12): read from the note's folder first, then like the wiki link of
 * the same text, and a target that ends in `/` names a folder. Until
 * 2026-10-22 the phone looked for a FILE called `Ablage/`, and `[Brief](Brief.md)`
 * created a second `Brief.md` beside the linking note while the letter lay in
 * another folder.
 */
const FILES: Array<[string, string]> = [
  ["vault/Start.md", "# Start\n\nFolder: [Ablage](Ablage/) · Name: [Brief](Brief.md)\n"],
  ["vault/Archiv/Brief.md", "# Brief\n\nThe letter from the archive.\n"],
  ["vault/Ablage/index.md", "# Ablage\n\nThe overview of the filing folder.\n"],
];

const markdownLink = (page: Page, text: string) => page.locator(".m-editor .cm-wiki-link[data-link-type=\"markdown\"]", { hasText: text }).first();

test("a Markdown link to a folder opens its overview, one to a name finds the note in another folder", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, FILES);

    await page.reload();
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Start", { exact: true }) }).first().click();
    await markdownLink(page, "Ablage").click();
    await expect(page.locator(".m-editor .cm-line", { hasText: "The overview of the filing folder" })).toBeVisible();

    // Back on the linking note (a reload would bring back the note last shown).
    await page.getByRole("button", { name: "Back" }).first().click();
    await markdownLink(page, "Brief").click();
    await expect(page.locator(".m-editor .cm-line", { hasText: "The letter from the archive" })).toBeVisible();
    // Nothing was created beside the linking note.
    const created = await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      return fs.stat({ path: "vault/Brief.md", directory: "DATA" }).then(() => true, () => false);
    });
    expect(created).toBe(false);
  } finally { sql.close(); }
});
