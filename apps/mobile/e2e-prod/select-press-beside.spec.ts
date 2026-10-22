import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import type { MobileTestGlobals } from "./exampleVault";

// The select list is the shared one (`Select`), and on the phone it lives in a
// database's filter sheet. Since Sammelplan § 3.100 it hears the tap beside it
// as every menu does (`useOutsidePress`): a finger by the `mousedown` the
// browser sends once its tap is made out. Tapping beside the list still closes
// it, and tapping an entry still takes the entry.

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (path) => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({
    path: `vault/${path}`, directory: "DATA", encoding: "utf8",
  })).data as string, path);
}

async function createTour(page: Page, context: BrowserContext) {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ language: "en", motion: "off" }));
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Start locally/ }).click();
  await page.getByRole("button", { name: "Plainva Tour", exact: true }).click();
  await expect.poll(() => readFile(page, "Welcome.md").catch(() => "")).toContain("Tour data version:");
  const close = page.getByTestId("whats-new-close");
  if (await close.isVisible()) await close.click();
  return sql;
}

test("a select list in the filter sheet closes on a tap beside it, and a tap on an entry takes the entry", async ({ page, context }) => {
  test.setTimeout(60_000);
  const sql = await createTour(page, context);
  try {
    await page.locator(".m-swipe-front").filter({ hasText: /^Quick Notes$/ }).first().click();
    await expect(page.locator(".m-pin-card")).toHaveCount(6);
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByRole("button", { name: /^Filter / }).click();
    await page.getByRole("button", { name: "+ Header color", exact: true }).click();
    const rule = page.locator(".m-filterrule").first();
    await rule.getByRole("button", { name: "is", exact: true }).click();

    const trigger = rule.getByRole("button", { name: "Value..." });
    const list = page.getByRole("listbox", { name: "Value..." });
    await trigger.tap();
    await expect(list).toBeVisible();

    // A tap beside it — on the sheet's title — closes it and takes nothing.
    await page.locator(".m-sheet-title").first().tap();
    await expect(list).toHaveCount(0);
    expect(await readFile(page, "Quick Notes.base")).not.toContain("#8a6d3b");

    await trigger.tap();
    await expect(list).toBeVisible();
    await page.getByRole("option", { name: "#8a6d3b", exact: true }).tap();
    await expect(list).toHaveCount(0);
    await expect.poll(() => readFile(page, "Quick Notes.base")).toContain('note.plainva.header_color == "#8a6d3b"');
    await expect(page.locator(".m-pin-card")).toHaveCount(1);
  } finally {
    sql.close();
  }
});
