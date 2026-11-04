import { test, expect } from "@playwright/test";

/**
 * Picking a service in the connect wizard has to OPEN something.
 *
 * It did not. Tapping "Files", "Calendar" or "Mail" after choosing a provider
 * did nothing at all, on iOS and on Android alike (#47, reported against
 * 0.6.2). The handler read `c.pop(); c.push(...)` — two operations that look
 * simultaneous and are not: `pop` asks about unsaved input first, so its state
 * update lands a microtask AFTER the push. The target opened and the late pop
 * closed it again, leaving the user on the list they had just tapped.
 *
 * Every check we had stayed green. The reducer was never wrong, so its unit
 * tests could not see it; the one test that did read the wiring asserted
 * `c.pop();` — it required the broken mechanism, and so held the fault in
 * place. A guard can cement a defect, which this project has now seen twice.
 *
 * Hence this: drive the real screens in the production bundle and ask what is
 * on the display afterwards. No mock can answer that question wrongly.
 */
test("picking a service opens its sign-in surface", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "de", motion: "off" }),
    );
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  // The release-highlights sheet lands a moment after the first paint and
  // would swallow the taps (same race as the swipe test next door).
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // Into the wizard the way a user gets there: app-bar menu → Settings →
  // Cloud accounts → add → provider. Real taps, because the route wiring
  // between those screens is precisely what is under test.
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.locator('[data-testid="cloudacct-connect"]').click();

  await page.locator('[data-testid="connect-family-webdav"]').click();
  const files = page.locator('[data-testid="connect-service-files"]');
  await expect(files).toBeVisible({ timeout: 10000 });

  // The rows TICK and a button goes on; both services of WebDAV are ticked
  // from the start (settings plan 2026-10-29: preselected as on the desktop).
  await expect(files.getByRole("checkbox")).toBeChecked();
  await expect(page.locator('[data-testid="connect-service-calendar"]').getByRole("checkbox")).toBeChecked();
  await page.locator('[data-testid="connect-start"]').click();

  // The defect: the wizard's own rows are still the thing on screen. What has
  // to hold is that the next surface is STILL there once the microtask queue
  // has drained - for WebDAV the one form of the sign-in step, asking for both
  // services' addresses at once (E5).
  await page.waitForTimeout(500);
  await expect(
    page.locator('[data-testid="connect-service-files"]'),
    "the wizard is still on screen — going on did nothing (#47)",
  ).toHaveCount(0);
  await expect(page.locator('[data-testid="connect-family-webdav"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connect-field-filesUrl"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="connect-field-caldavUrl"]')).toBeVisible();
});
