import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A time for a checkbox task (plan Rückmeldungen 2026-11-05, E3; TestFlight
 * wishes of 23.10. and 04.11.): Plainva reminds of `📅 2026-11-06 14:30`, but
 * the time could only be typed by hand — the due sheet said "a day only". Now
 * the sheet writes it after the date, keeps the rest of the line byte for
 * byte, takes it away again, and offers the vault's reminder switch for such
 * checkboxes right where the time is chosen.
 */

const NOW = "2026-09-20T10:00:00";
const NOTE = "# Haushalt\n\n- [ ] Anruf Bank ⏫ 🔁 every week 📅 2026-09-19 #geld\n";

const readNote = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: p, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);

test("the due sheet writes a time after a checkbox's date and offers its reminder switch", async ({ page, context }, testInfo) => {
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
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Haushalt.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = 'Haushalt.md'"), { timeout: 20_000 }).toBe(1);

    await page.locator(".m-tabbar .m-tab", { hasText: "Tasks" }).click();
    await page.getByTestId("tasks-list-today").click();
    const row = page.getByTestId("task-planner-section-overdue").getByTestId("task-planner-row").filter({ hasText: "Anruf Bank" });
    await row.getByTestId("task-planner-due").click();
    const sheet = page.getByTestId("task-due-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).not.toContainText("a day only");
    await sheet.getByTestId("task-due-time-switch").click();
    await sheet.getByTestId("task-due-time").fill("14:30");
    const reminders = sheet.getByTestId("task-due-reminders");
    await expect(reminders).toContainText("Reminders for checkboxes with a time are off for this vault.");
    await reminders.getByTestId("task-due-reminders-switch").click();
    // The setting itself, not a copy: the one the reminder settings show.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.mobile-vault-local") ?? "{}").remindCheckboxes)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("tasks-checkbox-time.png") });
    await sheet.getByTestId("task-due-time-done").click();

    await expect.poll(() => readNote(page, "vault/Haushalt.md")).toBe(NOTE.replace("📅 2026-09-19", "📅 2026-09-19 14:30"));
    await expect(row).toContainText("02:30 PM");

    // Switched off again, the time goes and the line is as it was.
    await row.getByTestId("task-planner-due").click();
    await expect(sheet.getByTestId("task-due-time")).toHaveValue("14:30");
    await expect(sheet.getByTestId("task-due-reminders")).toHaveCount(0);
    await sheet.getByTestId("task-due-time-switch").click();
    await sheet.getByTestId("task-due-time-done").click();
    await expect.poll(() => readNote(page, "vault/Haushalt.md")).toBe(NOTE);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
