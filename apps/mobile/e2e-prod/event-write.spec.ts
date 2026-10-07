import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Saving an event on the phone (issue 119).
 *
 * The sheet used to stay open until the provider had answered, and the event
 * only reached the screen after a whole sync cycle over every account. Now the
 * sheet closes with the save and the event is laid over the day at once; when
 * the provider refuses, the event is taken back and the refusal is said once,
 * with the way to try again.
 *
 * The fixture account has a writable calendar and no sign-in, so every write
 * is refused — which is the half of the promise a browser run can hold: the
 * moment between the save and the answer is held open in the shared unit test
 * (`useShownEvents.test.tsx`), where a provider can be made slow.
 */
test("a new event closes its sheet with the save; a refusal takes it back and offers to try again", async ({ page, context }) => {
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
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New event" }).click();
    const sheet = page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: "New event" }) });
    await expect(sheet).toBeVisible();

    await sheet.getByPlaceholder("Title").fill("Dentist at four");
    await sheet.getByRole("button", { name: "Save" }).click();

    // Closed with the save — not held open until a provider has answered.
    await expect(sheet).toHaveCount(0);
    const refused = page.locator(".pv-toast--error").filter({ hasText: "The event was not saved" });
    await expect(refused).toBeVisible();
    await expect(refused.locator(".pv-toast-action")).toHaveText("Try again");
    // Taken back: nothing on Today claims an event the provider never took.
    await expect(page.getByText("Dentist at four")).toHaveCount(0);

    // Trying again makes the same attempt, and says so again.
    await refused.locator(".pv-toast-action").click();
    await expect(page.locator(".pv-toast--error").filter({ hasText: "The event was not saved" })).toBeVisible();
    await expect(page.getByText("Dentist at four")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
