import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A property of one note renamed in the phone's note sheet (Sammelplan
 * § 3.173 no. 2), as the desktop's panel renames it in its name field: the
 * name changes where it stands — value, comment, order and line ends stay —
 * and a name the note has already is refused and said.
 */
test("a property of one note is renamed in its sheet, and a taken name is refused", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const NOTE = "---\r\nprio: 2 # kept\r\nowner: Anna\r\n---\r\n# Harbour plan\r\n\r\nThe harbour plan of the season.\r\n";
  const read = () => page.evaluate(async () =>
    String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/Harbour plan.md", directory: "DATA", encoding: "utf8" })).data));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Harbour plan.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    // Open the note through the search, then its details.
    const field = page.getByTestId("appbar-searchpage").locator("input");
    const search = page.getByRole("button", { name: /^Search$/ }).first();
    await page.waitForTimeout(1500);
    for (let i = 0; i < 5 && !(await field.isVisible()) && !(await search.isVisible()); i++) {
      const back = page.getByRole("button", { name: /^Back$/ }).first();
      if (await back.isVisible()) await back.click();
      await page.waitForTimeout(400);
    }
    if (!(await field.isVisible())) await search.click();
    await field.fill("harbour plan of the season");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Harbour plan", { timeout: 15000 });
    await page.locator("[data-search-occurrence]").first().click();
    await page.getByTestId("note-context").click();
    const sheet = page.locator(".m-sheet").first();
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // The property's sheet carries "Rename" at its foot.
    await sheet.getByRole("button", { name: /^prio/ }).click();
    await expect(page.getByTestId("prop-rename")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-note-property-rename-row.png") });
    await page.getByTestId("prop-rename").click();
    const prompt = page.locator(".m-sheet").filter({ hasText: "Only this note changes" });
    await expect(prompt).toBeVisible();
    await expect(prompt.locator("input")).toHaveValue("prio");
    await prompt.locator("input").fill("priority");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-note-property-rename-prompt.png") });
    await prompt.getByRole("button", { name: "OK", exact: true }).click();

    // Renamed where it stands: nothing else of the note changed.
    await expect.poll(read, { timeout: 10000 }).toBe(NOTE.replace("prio: 2", "priority: 2"));
    await expect(sheet.getByRole("button", { name: /^priority/ })).toBeVisible({ timeout: 10000 });

    // A name the note has already — in another casing — is refused and said.
    await sheet.getByRole("button", { name: /^priority/ }).click();
    await page.getByTestId("prop-rename").click();
    await prompt.locator("input").fill("Owner");
    await prompt.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.getByText("The note already has a property with the new name.")).toBeVisible({ timeout: 10000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-note-property-rename-refused.png") });
    expect(await read()).toBe(NOTE.replace("prio: 2", "priority: 2"));
  } finally {
    sql.close();
  }
});
