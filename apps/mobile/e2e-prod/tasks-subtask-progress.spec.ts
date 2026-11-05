import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The tasks tab from the tester's draft (plan Rückmeldungen 2026-11-05, P11;
 * TestFlight 02.11.): "1 of 3 done" at a task with subtasks, and the number of
 * tasks on the chosen list of the segment.
 */

const NOW = "2026-09-20T10:00:00";
const NOTE = [
  "# Umzug",
  "",
  "- [ ] Umzug vorbereiten 📅 2026-09-20",
  "  - [x] Kartons bestellen",
  "  - [ ] Halteverbot beantragen",
  "  - [ ] Nachsendeauftrag",
  "- [ ] Steuerunterlagen sortieren 📅 2026-09-20",
  "- [ ] Irgendwann aufräumen",
  "",
].join("\n");

test("a task with subtasks says how many are done, and the chosen list carries its number", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await page.clock.setFixedTime(new Date(NOW));
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Umzug.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Umzug.md'"), { timeout: 20_000 }).toBe(1);

    await page.locator(".m-tabbar .m-tab", { hasText: "Tasks" }).click();
    await page.getByTestId("tasks-list-today").click();
    await expect(page.getByTestId("tasks-list-today")).toHaveText("Today 2", { timeout: 20_000 });
    const today = page.getByTestId("task-planner-section-today");
    const parent = today.getByTestId("task-planner-row").filter({ hasText: "Umzug vorbereiten" }).first();
    await expect(parent.getByTestId("task-planner-progress")).toHaveText("1 of 3 done");
    await expect(today.getByTestId("task-planner-progress")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("tasks-subtask-progress.png") });

    // With the subtasks switched off the count stays at the task.
    await page.getByTestId("tasks-filter-subtasks").click();
    await expect(parent.getByTestId("task-planner-progress")).toHaveText("1 of 3 done");

    // The chosen list carries its number; Today keeps its own.
    await page.getByTestId("tasks-list-inbox").click();
    await expect(page.getByTestId("tasks-list-inbox")).toHaveText(/^Inbox \d+$/);
    await expect(page.getByTestId("tasks-list-today")).toHaveText("Today 2");
    await expect(page.getByTestId("tasks-list-upcoming")).toHaveText("Upcoming");
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
