import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * The areas sheet is a list of PLACES (finding 2026-09-24, E20).
 *
 * It was built as a choice: a ring on every row, filled on the area on screen,
 * four empty ones under "not in the bar" — a setting nobody had answered. An
 * area is somewhere you go. So no row wears a mark; the area on screen is the
 * row's current state (tint, weight, check, `aria-current`), the sheet has its
 * own title and a divider in place of the heading that named itself. Measured
 * in the production bundle, with the real styles.
 */
test("the areas sheet marks where you are and wears no ring", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "de", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    await page.getByTestId("tab-areas").click();
    const sheet = page.getByTestId("areas-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".m-sheet-title")).toHaveText("Bereiche");
    await expect(sheet.locator(".m-sheet-divider")).toHaveText("außerhalb der Leiste");
    await expect(sheet.locator(".m-slotmark")).toHaveCount(0);

    const current = sheet.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-testid", "areas-notes");
    await expect(current.locator(".pv-grouprow-check svg")).toBeVisible();
    const look = (el: Element) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, weight: cs.fontWeight };
    };
    const [on, off] = [await current.evaluate(look), await sheet.getByTestId("areas-graph").evaluate(look)];
    // Tinted and set in 600 — the other rows carry nothing.
    expect(on.weight).toBe("600");
    expect(on.background).not.toBe(off.background);
    await expect(sheet.locator(".pv-grouprow-check")).toHaveCount(1);

    // Going to an area outside the bar: it opens on top of the notes tab, and
    // the sheet marks the graph now — where the person is, not the tab below.
    await sheet.getByTestId("areas-graph").click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("tab-areas").click();
    await expect(page.getByTestId("areas-sheet").locator('[aria-current="page"]')).toHaveAttribute("data-testid", "areas-graph");
  } finally { sql.close(); }
});
