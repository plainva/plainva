import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Reminders for checkbox tasks on the phone (Sammelplan § 3.145 Nr. 1, decision
 * E3): a box whose due date carries a time (`📅 2026-11-02 14:30`) reminds like
 * a task of the task database, behind its own switch per vault. The operating
 * system is the web shell's notification plugin here — what it holds is read
 * from it. A tap cannot be played here: in the web shell the plugin's listeners
 * land on an instance its loader replaces (first calls in one tick each build
 * one), so the tap and "Tick off" are held by the unit tests of
 * `reminderActions`; a device registers them natively.
 */

const INDEX = "plainva-index";
const NOW = "2026-11-02T09:00:00";
const NOTE = ["# Haushalt", "", "- [ ] Müll rausbringen", "- [ ] Bob anrufen 📅 2026-11-02 14:30", "- [ ] Steuer 📅 2026-11-02", ""].join("\n");

type Pending = { title: string; body: string; actionTypeId?: string; schedule: { at: string }; extra: Record<string, unknown> };
type NotificationGlobals = typeof globalThis & {
  Capacitor: { Plugins: { LocalNotifications: { getPending(): Promise<{ notifications: Pending[] }> } } };
};

const pending = (page: Page) =>
  page.evaluate(async () => {
    const { notifications } = await (globalThis as NotificationGlobals).Capacitor.Plugins.LocalNotifications.getPending();
    return notifications.map((n) => ({ title: n.title, at: new Date(n.schedule.at).getTime(), actionTypeId: n.actionTypeId, extra: n.extra }));
  });

function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: `vault/${p}`, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);
}

test("a checkbox with a due time: its switch, its reminder at its time with its line, its hour under Today, and the reminder goes once it is ticked", async ({ page, context }, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const consoleLines: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") consoleLines.push(message.text()); });
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await page.clock.setFixedTime(new Date(NOW));
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The browser's notifications, granted and silent: the plugin keeps what it
    // is handed in its pending list, which is what this test reads.
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      addEventListener() {}
      close() {}
    }
    Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: FakeNotification });
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (text) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Haushalt.md", data: text, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => sql.count(INDEX, "files WHERE path = 'Haushalt.md'"), { timeout: 20_000 }).toBe(1);

    // Off by default: nothing is handed to the system.
    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.getByTestId("settings-area-pim").click();
    const row = page.getByTestId("reminder-checkboxes");
    await expect(row).toBeVisible({ timeout: 20_000 });
    const toggle = row.getByRole("switch", { name: "Checkboxes with a time" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await pending(page)).toEqual([]);
    await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("checkbox-reminders-switch.png") });

    // On: the box with a time is planned at its time, as a task, with its line;
    // the box with a date alone is not.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.mobile-vault-local") ?? "{}").remindCheckboxes))
      .toBe(true);
    await expect.poll(async () => (await pending(page)).map((n) => n.title), { timeout: 15_000 }).toEqual(["Bob anrufen"]);
    const [planned] = await pending(page);
    expect(planned.at).toBe(new Date(2026, 10, 2, 14, 30).getTime());
    expect(planned.actionTypeId).toBe("plainva-task");
    expect(planned.extra).toMatchObject({ kind: "task", line: { path: "Haushalt.md", ordinal: 1, text: "Bob anrufen 📅 2026-11-02 14:30" } });
    // Nothing was written into the note for it.
    expect(await readFile(page, "Haushalt.md")).toBe(NOTE);

    // Today → Due shows the box at its hour, the one rule for due values.
    // Back out of the settings: on a pushed screen the bar stands aside.
    await page.getByRole("button", { name: "Back" }).first().click();
    await page.getByRole("button", { name: "Back" }).first().click();
    await expect(page.locator(".m-tabbar.is-away")).toHaveCount(0);
    await page.locator(".m-tabbar .m-tab", { hasText: "Today" }).click();
    const due = page.getByTestId("today-task-row").filter({ hasText: "Bob anrufen" });
    await expect(due).toContainText("14:30", { timeout: 20_000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("checkbox-reminders-today.png") });

    // Ticked in the app, the line changes — and the reminder leaves the
    // system once the index has followed, without the app going away.
    await due.getByTestId("today-task-toggle").click();
    await expect.poll(() => readFile(page, "Haushalt.md"), { timeout: 15_000 }).toMatch(/- \[ \] Müll rausbringen\n- \[x\] Bob anrufen 📅 2026-11-02 14:30 ✅ 2026-11-02\n- \[ \] Steuer 📅 2026-11-02\n/);
    await expect.poll(() => pending(page), { timeout: 15_000 }).toEqual([]);
    expect(errors).toEqual([]);
  } catch (failure) {
    await page.screenshot({ path: testInfo.outputPath("checkbox-reminders-failure.png") });
    console.log("page errors:", errors, "console:", consoleLines.slice(-30));
    throw failure;
  } finally {
    sql.close();
  }
});
