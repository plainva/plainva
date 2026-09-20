import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("task filters return after note navigation and restart with a clearable missing folder", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off", tabSlots: ["browse", "tasks", "settings"], barTabCount: 3 }));
    if (!localStorage.getItem("plainva-task-view-local")) localStorage.setItem("plainva-task-view-local", JSON.stringify({ version: 1, status: "all", text: "old", folder: "Removed", tag: "missing", dueOnly: true, showHidden: true, list: "all" }));
  });
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Task note.md", data: "# Task note\n\n- [ ] remember me\n- [x] finished\n", directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    const tasks = page.locator(".m-tabbar").getByRole("button", { name: /Tasks/ });
    await tasks.click();
    const search = page.getByPlaceholder(/Filter tasks/);
    await expect(search).toHaveValue("old");
    await expect(page.getByTestId("tasks-filters")).toContainText("Removed (Unavailable)");
    await page.getByTestId("tasks-reset-filters").click();
    await page.getByTestId("tasks-filter-all").click(); await search.fill("remember");
    await page.getByRole("button", { name: /remember me/ }).click();
    await expect(page.getByTestId("note-menu")).toBeVisible();
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(search).toHaveValue("remember");
    await page.reload();
    await expect(search.or(page.getByTestId("note-menu"))).toBeVisible();
    if (await page.getByTestId("note-menu").isVisible()) await page.getByRole("button", { name: /^Back$/ }).click();
    if (!await search.isVisible()) await tasks.click();
    await expect(search).toHaveValue("remember");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("plainva-task-view-local")!))).toEqual({ version: 1, status: "all", text: "remember", folder: "", tag: "", dueOnly: false, showHidden: false, list: "all" });
  } finally { sql.close(); }
});
