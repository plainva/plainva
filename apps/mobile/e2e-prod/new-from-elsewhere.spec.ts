import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * "New event" in the ＋ menu of another tab (plan Befunde 2026-09-24, E28 —
 * the same class the task suite found for "New task"). The request opens the
 * Today tab, which MOUNTS with the request already waiting while its writable
 * calendars are still loading; the screen took the request at once, found no
 * calendar yet and answered "No writable calendar selected." although the
 * vault has one. The request now waits until the screen can serve it.
 */
test("New event from another tab opens the event sheet on Today when the vault has a writable calendar", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    // A calendar account with a writable calendar, in the index database the
    // first start created.
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New event" }).click();

    await expect(page.locator(".m-tabbar .m-tab.is-active")).toContainText("Today");
    await expect(page.locator(".m-sheet .m-sheet-title", { hasText: "New event" })).toBeVisible();
    await expect(page.locator(".pv-toast").filter({ hasText: "No writable calendar selected." })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
