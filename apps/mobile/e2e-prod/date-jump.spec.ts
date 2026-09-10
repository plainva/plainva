import { test, expect } from "@playwright/test";

/**
 * The date jump on the phone (plan Kalender, Anker-Links, Dependabot
 * 2026-09-10, P3): the period under the calendar's title is a button, and it
 * opens the shared picker as a sheet. A picked day moves the calendar there.
 *
 * Runs against the production bundle like the other checks here, because the
 * sheet, the picker and the app bar are three shared pieces meeting in one
 * place — exactly the kind of seam a bundle split can break while every unit
 * test stays green.
 */
test("tapping the period opens the date jump sheet, and a picked day moves the calendar", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "en", motion: "off" }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  // The release-highlights sheet arrives a moment after the first paint and
  // would swallow the taps (see swipe-gesture.spec.ts).
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // The calendar area: from the bar when it holds the tab, otherwise through
  // the areas sheet that lists the whole pool.
  const tab = page.locator(".m-tabbar .m-tab", { hasText: /^Calendar$/ });
  if (await tab.count()) {
    await tab.first().click();
  } else {
    await page.locator('[data-testid="tab-areas"]').click();
    await page.getByRole("button", { name: /^Calendar$/ }).first().click();
  }

  const title = page.locator('[data-testid="pim-title"]');
  await expect(title).toBeVisible({ timeout: 20000 });
  const before = (await title.textContent())!.trim();

  await title.click();
  const sheet = page.locator('[data-testid="pim-jump-sheet"]');
  await expect(sheet).toBeVisible();

  const year = new Date().getFullYear() + 1;
  await sheet.locator('[data-testid="pim-jump-next-year"]').click();
  await sheet.locator('[data-testid="pim-jump-month-2"]').click();
  await sheet.locator(`[data-testid="pim-jump-day-${year}-03-03"]`).click();

  await expect(sheet).toHaveCount(0);
  await expect(title).not.toHaveText(before);
  // Every view names the day or the month it shows; a jump to March of next
  // year is visible in the period whichever view was remembered.
  await expect(title).toContainText(/March|3/);
});
