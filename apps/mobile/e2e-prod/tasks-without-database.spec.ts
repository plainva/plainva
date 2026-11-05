import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A task in a vault without a task database (plan Rückmeldungen 2026-11-05,
 * E1; TestFlight feedback of 31.10.): "+" in the tasks tab used to do nothing
 * at all. Now the capture sheet opens, says where the task goes, and the task
 * lands as a checkbox in today's daily note — the rule Siri and Shortcuts
 * follow — and stands in Today at once.
 */

const NOW = "2026-09-20T10:00:00";

const readNote = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: p, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);

test("no task database: New task opens the sheet, the task becomes a checkbox in today's daily note and shows in Today", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await page.clock.setFixedTime(new Date(NOW));
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    // The tab on its own: the empty "All" offers New task too.
    await page.locator(".m-tabbar .m-tab", { hasText: "Tasks" }).click();
    await page.getByTestId("tasks-list-all").click();
    await page.getByTestId("tasks-empty-new").click();
    const sheet = page.getByTestId("task-capture-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("task-capture-daily")).toContainText("today's daily note");
    await expect(sheet.getByTestId("task-capture-create-db")).toBeVisible();
    await expect(sheet.getByTestId("task-capture-provider")).toHaveCount(0);
    await sheet.getByTestId("task-capture-input").fill("Steuerunterlagen sortieren");
    await sheet.getByTestId("task-capture-quick").getByRole("button", { name: "Today", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("tasks-capture-no-database.png") });
    await sheet.getByTestId("task-capture-submit").click();

    await expect(sheet).toHaveCount(0);
    await expect.poll(() => readNote(page, "vault/2026-09-20.md")).toMatch(/## Journal\n\n- \[ \] 10:00 Steuerunterlagen sortieren 📅 2026-09-20\n$/);

    // It is a checkbox the planner knows: in Today, from the daily note.
    await page.getByTestId("tasks-list-today").click();
    const today = page.getByTestId("task-planner-section-today");
    await expect(today.getByTestId("task-planner-row").filter({ hasText: "Steuerunterlagen sortieren" })).toHaveAttribute("data-source", "note", { timeout: 20_000 });
    // Named without the journal's time stamp: that is when it was noted, not what it is called.
    await expect(today.getByTestId("task-planner-row").filter({ hasText: "Steuerunterlagen sortieren" }).locator(".pv-grouprow-title")).toHaveText("Steuerunterlagen sortieren");

    // From another tab, through the ＋ menu, the same sheet.
    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New task" }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("task-capture-daily")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
