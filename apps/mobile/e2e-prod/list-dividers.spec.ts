import { test, expect } from "@playwright/test";

/**
 * The hairline between two rows of a list (TestFlight 2026-10-28, build 149:
 * "Today" had no lines between its entries, other areas did). The divider
 * rule and the row's own border reset weighed the same and the reset came
 * later, so every row that is itself a child of its list lost the line; only
 * rows inside a swipe container (the Tasks tab) kept it. Measured in the
 * production bundle, because it is the cascade of the shipped stylesheet that
 * decides, not a component.
 */
test("rows of a plain list are divided by a visible hairline", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "en", motion: "off" }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const whatsNew = page.getByTestId("whats-new-close");
  if (await whatsNew.isVisible()) await whatsNew.click();
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // The settings page is a list of plain rows on every vault.
  await page.locator('[data-testid="nav-settings"]').first().click();
  const second = page.locator(".pv-grouprows > .pv-grouprow + .pv-grouprow").first();
  await expect(second).toBeVisible({ timeout: 20000 });

  const line = await second.evaluate((row) => {
    const style = getComputedStyle(row);
    const card = getComputedStyle(row.closest(".pv-grouprows")!.parentElement!);
    return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor, behind: card.backgroundColor };
  });
  expect(line.width).toBe("1px");
  expect(line.style).toBe("solid");
  // A line the colour of the card behind it would be no line at all.
  expect(line.color).not.toBe(line.behind);
  expect(line.color).not.toBe("rgba(0, 0, 0, 0)");

  // The first row of a list draws nothing above itself.
  const first = page.locator(".pv-grouprows > .pv-grouprow:first-child").first();
  expect(await first.evaluate((row) => getComputedStyle(row).borderTopWidth)).toBe("0px");
});
