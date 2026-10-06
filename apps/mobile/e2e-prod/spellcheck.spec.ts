import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Spell checking as a device switch on the phone (plan Befunde 2026-10-06, E3).
 *
 * Against the production bundle: the switch sits under Settings -> Editor &
 * notes, it is off by default, it is stored with the device, and the note
 * editor follows it. What checks the text on a phone is the keyboard and the
 * system; the red lines are theirs and no suite sees them - what is asserted is
 * the attribute the app sets, which is all the app decides.
 */
test("the switch under Editor & notes turns checking on for the note editor, and it is stored", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const notes: Array<[string, string]> = [
    ["vault/Letter.md", "# Letter\n\nA sentence with a mistaek and `code` in it.\n"],
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

    // The document says which language the app speaks, and starts unchecked.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("spellcheck", "false");

    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();
    // After a reload the session may come back on any screen of the stack it
    // last saved, so walk back to where the search can be reached first.
    const openLetter = async () => {
      const field = page.getByTestId("appbar-searchpage").locator("input");
      const search = page.getByRole("button", { name: /^Search$/ }).first();
      await page.waitForTimeout(1500);
      for (let i = 0; i < 5 && !(await field.isVisible()) && !(await search.isVisible()); i++) {
        if (await page.getByRole("button", { name: /^Back$/ }).first().isVisible()) await back();
        await page.waitForTimeout(400);
      }
      if (!(await field.isVisible())) await search.click();
      await field.fill("mistaek");
      await expect(page.locator("[data-search-occurrence]").first()).toContainText("Letter");
      await page.locator("[data-search-occurrence]").first().click();
    };
    await openLetter();

    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible({ timeout: 15000 });
    // Off by default; the keyboard's own smartness is a different matter and on.
    await expect(content).toHaveAttribute("spellcheck", "false");
    await expect(content).toHaveAttribute("autocorrect", "on");

    // The switch: Settings -> Editor & notes.
    await back();
    await back();
    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.locator('[data-testid="settings-area-editor"]').click();
    const toggle = page.getByRole("switch", { name: "Spell checking" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText(/uses your system's spell checker/)).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // Stored with the device, not merely applied.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.mobile-settings") ?? "{}").spellcheck)).toBe(true);
    await back();
    await back();

    // The editor follows: the note itself is checked, the code in it is not.
    await openLetter();
    await expect(content).toHaveAttribute("spellcheck", "true", { timeout: 15000 });
    await expect(content).toHaveAttribute("autocorrect", "on");
    await expect(content.locator('[spellcheck="false"]', { hasText: "code" })).toHaveCount(1);

    // It survives a reload.
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await openLetter();
    await expect(page.locator(".cm-content").first()).toHaveAttribute("spellcheck", "true", { timeout: 15000 });
  } finally { sql.close(); }
});
