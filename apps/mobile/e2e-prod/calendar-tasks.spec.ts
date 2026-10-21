import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Tasks in the phone's calendar (TestFlight, build 125): "Is it planned to
 * show the tasks in the calendar? Switching it on in the calendar does
 * nothing." The switch the tester found was the chip of the task database's
 * timeline view: its entries were drawn in the month and the agenda only, and
 * the calendar opens on the day. The desktop's "Show tasks" did not exist on
 * the phone at all.
 *
 * Here both work in the day view: "Show tasks" puts a task without a time in
 * the all-day strip and one with a time at its hour, each with its box, and a
 * tick writes the note; the database chip draws its entries there too.
 */

const INDEX = "plainva-index";

const TASK_BASE = `filters:
  and:
    - file.folder == "Aufgaben"
properties:
  note.status:
    displayName: Status
    plainva:
      input: select
      options:
        - Offen
        - In Arbeit
        - Erledigt
  note.frist:
    displayName: Frist
    plainva:
      input: datetime
views:
  - type: table
    name: Tabelle
  - type: timeline
    name: Zeitleiste
    dateField: frist
`;

const note = (title: string, frist: string) => `---\ntype: Note\nstatus: Offen\nfrist: ${frist}\n---\n# ${title}\n`;

async function writeFiles(page: Page, files: Array<[string, string]>) {
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, files);
}

function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: `vault/${p}`, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);
}

test("Show tasks and a database chip draw their entries in the day view, and a tick there writes the note", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  // No provider is asked for real.
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    if (!localStorage.getItem("CapacitorStorage.mobile-vault-local")) localStorage.setItem("CapacitorStorage.mobile-vault-local", JSON.stringify({ taskDatabase: "Aufgaben.base" }));
    // The account's sign-in slot for this device: without it the calendar
    // explains the missing sign-in instead of showing the grid.
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
    localStorage.setItem("plainva-calendar-view", "day");
  });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await writeFiles(page, [
      ["Aufgaben.base", TASK_BASE],
      ["Aufgaben/Steuer abgeben.md", note("Steuer abgeben", today)],
      ["Aufgaben/Anruf beim Amt.md", note("Anruf beim Amt", `${today}T15:00`)],
    ]);
    await page.reload();
    await expect.poll(() => sql.count(INDEX, "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim(INDEX);
    await expect.poll(() => sql.count(INDEX, "files WHERE path LIKE 'Aufgaben/%'"), { timeout: 20_000 }).toBe(2);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    const tab = page.locator(".m-tabbar .m-tab", { hasText: /^Calendar$/ });
    if (await tab.count()) await tab.first().click();
    else {
      await page.getByTestId("tab-areas").click();
      await page.getByRole("button", { name: /^Calendar$/ }).first().click();
    }
    const grid = page.getByTestId("pim-timegrid");
    await expect(grid).toBeVisible({ timeout: 20_000 });

    // "Show tasks": off by default, a chip in the row above the calendar.
    const showTasks = page.getByTestId("pim-show-tasks");
    await expect(showTasks).toBeVisible();
    await expect(grid.getByTestId("pim-task")).toHaveCount(0);
    await showTasks.click();
    const allDay = grid.getByTestId("pim-task").filter({ hasText: "Steuer abgeben" });
    const timed = grid.getByTestId("pim-task").filter({ hasText: "Anruf beim Amt" });
    await expect(allDay).toBeVisible();
    await expect(timed).toBeVisible();
    // A task without a time belongs to the day, one with a time to its hour.
    expect(await allDay.evaluate((el) => getComputedStyle(el).position)).not.toBe("absolute");
    expect(await timed.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: "test-results/calendar-tasks-day.png" });

    // The box ticks the task off right there: the note says so.
    await allDay.getByTestId("pim-task-toggle").click();
    await expect.poll(() => readFile(page, "Aufgaben/Steuer abgeben.md"), { timeout: 10_000 }).toContain("status: Erledigt");
    await expect(allDay.getByTestId("pim-task-toggle")).toHaveAttribute("data-state", "done");

    // The database chip draws its entries in the day view as well.
    await showTasks.click();
    await expect(grid.getByTestId("pim-task")).toHaveCount(0);
    const chip = page.getByTestId("pim-overlay-Aufgaben.base#Zeitleiste");
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(grid.getByTestId("pim-overlay-entry").filter({ hasText: "Steuer abgeben" })).toBeVisible();
    const timedEntry = grid.getByTestId("pim-overlay-entry").filter({ hasText: "Anruf beim Amt" });
    await expect(timedEntry).toBeVisible();
    expect(await timedEntry.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");

    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
