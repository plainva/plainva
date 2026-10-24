import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * What is due on a day, on the phone (TestFlight, build 136): "Tasks due today
 * from notes in the Tasks plugin format do not show under Today → Due, unlike
 * the tasks from the database." The planner's Today list had both sources all
 * along; the Today screen, the calendar and the widget read the task database
 * alone. Here the Today screen and the calendar answer from both — a checkbox
 * in a note with a 📅 date stands beside a database entry, what is late leads
 * on today, a note that opts out stays out, and a tick writes the note's line.
 */

const INDEX = "plainva-index";
/** A Sunday morning: Thursday and Friday are overdue, Tuesday is upcoming. */
const NOW = "2026-09-20T10:00:00";

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
    order:
      - note.status
      - note.frist
`;

const taskNote = (title: string, frist: string) => `---\ntype: Note\nstatus: Offen\nfrist: ${frist}\n---\n# ${title}\n`;

const HOUSEHOLD = [
  "# Haushalt",
  "",
  "- [ ] Drucker einrichten 📅 2026-09-20",
  "- [ ] Rechnung bezahlen 📅 2026-09-17",
  "- [x] Brief eingeworfen 📅 2026-09-20",
  "- [ ] Kuchen backen 📅 2026-09-22",
  "- [ ] Irgendwann aufräumen",
  "",
].join("\n");

/** A note that opts out of task aggregation: its box is not anyone's to-do. */
const TEMPLATE = "---\nplainva:\n  tasks: false\n---\n# Vorlage\n\n- [ ] Vorlagenaufgabe 📅 2026-09-20\n";

type Bridge = Awaited<ReturnType<typeof installSqlBridge>>;

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

const indexed = (sql: Bridge, path: string) => sql.count(INDEX, `files WHERE path = '${path.replace(/'/g, "''")}'`);

/** The app on a vault with these files, under the fixed clock; with or without a task database. */
async function start(page: Page, context: BrowserContext, sql: Bridge, files: Array<[string, string]>, taskDatabase: string | null) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.clock.setFixedTime(new Date(NOW));
  await context.addInitScript((db) => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    if (db && !localStorage.getItem("CapacitorStorage.mobile-vault-local")) localStorage.setItem("CapacitorStorage.mobile-vault-local", JSON.stringify({ taskDatabase: db }));
  }, taskDatabase);
  await page.goto("/");
  await waitForVaultDirectory(page);
  await writeFiles(page, files);
  await page.reload();
  await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
  for (const [path] of files) if (path.endsWith(".md")) await expect.poll(() => indexed(sql, path), { timeout: 20_000 }).toBe(1);
}

const dueTitles = (page: Page) => page.getByTestId("today-task-row").locator(".pv-grouprow-title");

test("Today → Due: a checkbox from a note stands beside a database entry, what is late leads, and a tick writes the line", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sql = await installSqlBridge(context);
  try {
    await start(
      page,
      context,
      sql,
      [
        ["Aufgaben.base", TASK_BASE],
        ["Aufgaben/Angebot schicken.md", taskNote("Angebot schicken", "2026-09-20")],
        ["Aufgaben/Steuer abgeben.md", taskNote("Steuer abgeben", "2026-09-18")],
        ["Haushalt.md", HOUSEHOLD],
        ["Vorlage.md", TEMPLATE],
      ],
      "Aufgaben.base",
    );
    await page.locator(".m-tabbar .m-tab", { hasText: "Today" }).click();

    // Overdue first, oldest first; then what is due today — both sources.
    await expect(dueTitles(page)).toHaveText(["Rechnung bezahlen", "Steuer abgeben", "Angebot schicken", "Drucker einrichten"], { timeout: 20_000 });
    const printer = page.getByTestId("today-task-row").filter({ hasText: "Drucker einrichten" });
    await expect(printer).toHaveAttribute("data-source", "note");
    await expect(page.getByTestId("today-task-row").filter({ hasText: "Angebot schicken" })).toHaveAttribute("data-source", "database");
    await expect(page.getByTestId("today-task-row").filter({ hasText: "Rechnung bezahlen" })).toHaveAttribute("data-overdue", "true");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: "test-results/today-due.png", fullPage: true });

    // The box ticks the note's line, and the done task leaves the list.
    await printer.getByTestId("today-task-toggle").click();
    await expect.poll(() => readFile(page, "Haushalt.md"), { timeout: 10_000 }).toContain("- [x] Drucker einrichten");
    await expect(dueTitles(page)).toHaveText(["Rechnung bezahlen", "Steuer abgeben", "Angebot schicken"]);
    // Nothing else in the note moved.
    const after = (await readFile(page, "Haushalt.md")) ?? "";
    expect(after.split("\n").filter((line) => !line.includes("Drucker einrichten"))).toEqual(HOUSEHOLD.split("\n").filter((line) => !line.includes("Drucker einrichten")));

    // A day without overdue: the next Tuesday shows only its own task.
    await page.locator(".m-datestrip-day", { hasText: "22" }).click();
    await expect(dueTitles(page)).toHaveText(["Kuchen backen"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("Today → Due without a task database: the checkboxes in notes are what is due", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sql = await installSqlBridge(context);
  try {
    await start(page, context, sql, [["Haushalt.md", HOUSEHOLD], ["Vorlage.md", TEMPLATE]], null);
    await page.locator(".m-tabbar .m-tab", { hasText: "Today" }).click();
    await expect(dueTitles(page)).toHaveText(["Rechnung bezahlen", "Drucker einrichten"], { timeout: 20_000 });
    // A tap on the row opens the note the checkbox lives in.
    await page.getByTestId("today-task-row").filter({ hasText: "Drucker einrichten" }).locator(".pv-grouprow-title").click();
    await expect(page.getByTestId("today-task-row")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("the calendar's Show tasks puts a checkbox from a note on its day, without a task database, and its box ticks the line", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
    localStorage.setItem("plainva-calendar-view", "day");
  });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const note = `# Haushalt\n\n- [ ] Drucker einrichten 📅 ${today}\n`;
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await writeFiles(page, [["Haushalt.md", note]]);
    await page.reload();
    await expect.poll(() => sql.count(INDEX, "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim(INDEX);
    await expect.poll(() => indexed(sql, "Haushalt.md"), { timeout: 20_000 }).toBe(1);
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
    const showTasks = page.getByTestId("pim-show-tasks");
    await expect(showTasks).toBeVisible();
    await showTasks.click();
    const row = grid.getByTestId("pim-task").filter({ hasText: "Drucker einrichten" });
    await expect(row).toBeVisible();
    await row.getByTestId("pim-task-toggle").click();
    await expect.poll(() => readFile(page, "Haushalt.md"), { timeout: 10_000 }).toContain("- [x] Drucker einrichten");
    await expect(row.getByTestId("pim-task-toggle")).toHaveAttribute("data-state", "done");
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
