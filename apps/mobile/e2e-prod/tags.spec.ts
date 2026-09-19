import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Tags as pills on the phone (finding 2026-09-19, plan Rueckmeldungen P7).
 *
 * The phone has no separate reading renderer - its reading mode IS the live
 * editor - so the pill there is the editor's mark. Against the real SQLite
 * index: the pill marks what the index counts, a tap WHILE READING opens the
 * notes with the tag, and the device switch "Colour tags" colours by the root.
 */
test("a tag is a pill, a tap opens its notes, and the switch colours it by its root", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  // Seeded ONCE: the init script runs on every load, and the reload below has
  // to find the setting the test changed, not a fresh copy of this one.
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const notes: Array<[string, string]> = [
    ["vault/Tagged.md", "---\ntags: [project/site, idea]\n---\n# Tagged\n\nWork on #project/site and #project/print, maybe an #idea. Issue #42 is a number, `#code` is code.\n"],
    ["vault/Other.md", "# Other\n\nAlso #project/site here.\n"],
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

    // Open the note the way a reader does: through the search. After a reload
    // the session may come back on ANY screen of the stack it last saved - the
    // snapshot is written a moment after a navigation - so first walk back to
    // where the search can be reached (the first pre-push run found the
    // settings screen here and no "Search" to press).
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();
    const openTagged = async () => {
      const field = page.getByTestId("appbar-searchpage").locator("input");
      const search = page.getByRole("button", { name: /^Search$/ }).first();
      await page.waitForTimeout(1500);
      for (let i = 0; i < 5 && !(await field.isVisible()) && !(await search.isVisible()); i++) {
        if (await page.getByRole("button", { name: /^Back$/ }).first().isVisible()) await back();
        await page.waitForTimeout(400);
      }
      if (!(await field.isVisible())) await search.click();
      await field.fill("maybe an");
      await expect(page.locator("[data-search-occurrence]").first()).toContainText("Tagged");
      await page.locator("[data-search-occurrence]").first().click();
    };
    await openTagged();

    const pills = page.locator(".cm-content .pv-tag-pill");
    await expect(pills).toHaveText(["#project/site", "#project/print", "#idea"], { timeout: 15000 });
    await expect(pills.nth(0).locator(".pv-tag-parent")).toHaveText("#project/");
    // Off by default: all three stand on the same neutral ground.
    const neutral = await pills.evaluateAll((els: Element[]) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(new Set(neutral).size).toBe(1);

    // The properties draw the note's tags as chips with the same colour slot -
    // the row used to join them into one text, which left the switch nothing
    // to colour there.
    await page.getByTestId("note-context").click();
    const chips = page.getByTestId("prop-tags").locator(".pv-chip-tag");
    await expect(chips).toHaveText(["project/site", "idea"], { timeout: 10000 });
    await expect(chips.first()).toHaveAttribute("data-tag-color", /^[1-7]$/);
    await expect(chips.first().locator(".pv-tag-parent")).toHaveText("project/");
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

    // A tap while READING opens the notes that carry the tag.
    await pills.nth(0).tap();
    await expect(page.getByTestId("appbar-tags")).toContainText("#project/site", { timeout: 10000 });
    await expect(page.getByText("Other", { exact: true }).first()).toBeVisible();
    await back();
    await expect(pills.first()).toBeVisible();

    // The switch lives under Appearance; it is a device setting.
    await back();
    await back();
    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.locator('[data-testid="settings-area-appearance"]').click();
    await page.getByRole("switch", { name: "Colour tags" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-tag-colors", "on");
    // The reload below must find the setting STORED, not merely applied.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.mobile-settings") ?? "{}").tagColors)).toBe(true);
    await back();
    await back();

    // It survives a reload, and the pills of one root now share a ground that
    // is not the neutral one.
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-tag-colors", "on", { timeout: 15000 });
    await openTagged();
    await expect(pills).toHaveCount(3, { timeout: 15000 });
    const coloured = await pills.evaluateAll((els: Element[]) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(coloured[0]).toBe(coloured[1]);
    expect(coloured[0]).not.toBe(neutral[0]);
  } finally { sql.close(); }
});
