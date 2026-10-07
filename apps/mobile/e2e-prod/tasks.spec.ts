import { createHash } from "node:crypto";
import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { returnToApp, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";
import { installShareInbox } from "./shareInbox";

/**
 * Tasks on the phone, against the production bundle (plan Befunde 2026-09-24,
 * E28): the functional suite the task surfaces never had. The planner lists,
 * the capture sheet, the review of tasks that exist more than once, "Create as
 * a task" in the share sheet, and the one-time offer to clean up task-note
 * names that carry an id (E12).
 *
 * Everything runs on the real index (the fixture SQLite bridge) under a fixed
 * clock, and every step asserts the two things that matter: what the person
 * sees, and what lands in the files. Where something must NOT appear, a
 * recorder notes everything that ever did, and the step ends on a change that
 * has to show — so an absence is never a question of looking too early.
 */

const INDEX = "plainva-index";
/** A Sunday morning: Friday is overdue, Tuesday and Wednesday are upcoming. */
const NOW = "2026-09-20T10:00:00";

/**
 * The task database: status first (its first option is open, its last done),
 * a due column that takes a time, and a priority column. The status column
 * has to come first — the completion model reads the first select.
 */
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
  note.priority:
    displayName: Priority
    plainva:
      input: select
      options:
        - High
        - Medium
        - Low
views:
  - type: table
    name: Tabelle
    order:
      - note.status
      - note.frist
      - note.priority
`;

interface Anchor {
  uid: string;
  list?: string;
  provider?: string;
  identity?: string;
}

/** A task note the way Plainva writes one; `anchor` makes it a mirrored provider task. */
function taskNote(title: string, fields: { status?: string; frist?: string; priority?: string; anchor?: Anchor; body?: string } = {}): string {
  const lines = ["---", "type: Note"];
  const a = fields.anchor;
  if (a) {
    lines.push("plainva:", "  pim:", "    kind: task", `    provider: ${a.provider ?? "google"}`);
    if (a.identity) lines.push(`    identity: ${a.identity}`);
    lines.push(`    list: ${a.list ?? "L1"}`, `    uid: ${a.uid}`);
  }
  if (fields.status) lines.push(`status: ${fields.status}`);
  if (fields.frist) lines.push(`frist: ${fields.frist}`);
  if (fields.priority) lines.push(`priority: ${fields.priority}`);
  lines.push("---", `# ${title}`, "");
  if (fields.body) lines.push(fields.body, "");
  return lines.join("\n");
}

/** The id Plainva put into a mirrored task's name from 12.09. to 24.09.: the start of the hash of its identity. */
const legacyHex = (a: Required<Anchor>) => createHash("sha256").update(JSON.stringify([a.provider, a.identity, a.list, a.uid])).digest("hex").slice(0, 16);

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

function listFolder(page: Page, folder: string): Promise<string[]> {
  return page.evaluate(async (dir) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readdir({ path: `vault/${dir}`, directory: "DATA" })).files.filter((f) => f.type === "file").map((f) => f.name).sort();
  }, folder);
}

/** Every file below `folder` with its text, sorted by path. */
function readTree(page: Page, folder: string): Promise<Array<{ path: string; text: string }>> {
  return page.evaluate(async (root) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const out: Array<{ path: string; text: string }> = [];
    const walk = async (dir: string) => {
      let files;
      try {
        files = (await fs.readdir({ path: `vault/${dir}`, directory: "DATA" })).files;
      } catch {
        return;
      }
      for (const f of files) {
        const path = `${dir}/${f.name}`;
        if (f.type === "directory") await walk(path);
        else out.push({ path, text: String((await fs.readFile({ path: `vault/${path}`, directory: "DATA", encoding: "utf8" })).data) });
      }
    };
    await walk(root);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }, folder);
}

type SqlBridge = { all(db: string, s: string, p: unknown[]): Promise<Array<Record<string, unknown>>>; exec(db: string, s: string, p: unknown[]): Promise<void> };

/** One statement on the index database, through the page's own bridge. */
function sqlAll(page: Page, sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(([db, statement, values]) => (globalThis as unknown as { __plainvaFixtureSql: SqlBridge }).__plainvaFixtureSql.all(db, statement, values), [INDEX, sql, params] as const);
}
function sqlExec(page: Page, sql: string, params: unknown[] = []): Promise<void> {
  return page.evaluate(([db, statement, values]) => (globalThis as unknown as { __plainvaFixtureSql: SqlBridge }).__plainvaFixtureSql.exec(db, statement, values), [INDEX, sql, params] as const);
}

const indexed = (sql: Bridge, path: string) => sql.count(INDEX, `files WHERE path = '${path.replace(/'/g, "''")}'`);

/**
 * The note the task reconciler on this device maintains for a task
 * (`pim_task_state.note_path`), under an account that exists — the PIM cycle
 * sweeps state rows of accounts it does not know. Switched off, so no cycle
 * reaches for a provider.
 */
async function bindTaskNote(page: Page, uid: string, notePath: string) {
  await sqlExec(page, "INSERT OR IGNORE INTO pim_accounts (id, provider, label, config, enabled) VALUES (?, ?, ?, ?, 0)", ["pim-1", "google", "me@example.org", "{}"]);
  await sqlExec(page, "INSERT INTO pim_task_state (account_id, list_id, uid, note_path) VALUES (?, ?, ?, ?)", ["pim-1", "L1", uid, notePath]);
}

/** Uncaught errors are defects wherever they come from; every test ends by asking for none. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Notes, on every page load, each text the element with `testId` ever showed —
 * from the first render on. Read with {@link shown}.
 */
async function recordShown(context: BrowserContext, testId: string) {
  await context.addInitScript((id) => {
    const log: string[] = [];
    (globalThis as unknown as Record<string, string[]>)[`__shown:${id}`] = log;
    const look = () => {
      const text = document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
      if (text !== null && !log.includes(text)) log.push(text);
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  }, testId);
}
const shown = (page: Page, testId: string) => page.evaluate((id) => (globalThis as unknown as Record<string, string[]>)[`__shown:${id}`], testId);


/**
 * The app on a vault with these files, under the fixed clock, with the task
 * database set for this vault. Returns once the index knows every note.
 */
async function start(page: Page, context: BrowserContext, sql: Bridge, files: Array<[string, string]>) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.clock.setFixedTime(new Date(NOW));
  // Seeded once: the init script runs on every load, and a reload has to find
  // what the app wrote, not a fresh copy of this.
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The task database is a setting of the VAULT (settings scopes, P1).
    if (!localStorage.getItem("CapacitorStorage.mobile-vault-local")) localStorage.setItem("CapacitorStorage.mobile-vault-local", JSON.stringify({ taskDatabase: "Aufgaben.base" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await writeFiles(page, files);
  await restart(page);
  for (const [path] of files) if (path.endsWith(".md")) await expect.poll(() => indexed(sql, path), { timeout: 20_000 }).toBe(1);
}

async function restart(page: Page) {
  await page.reload();
  await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
}

/** The tab: a tap on it always shows the tasks screen itself, never a note pushed onto it. */
async function openTasks(page: Page) {
  await page.locator(".m-tabbar .m-tab", { hasText: "Tasks" }).click();
  await expect(page.getByTestId("tasks-filters")).toBeVisible();
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Planner rows of a section, by what they say. */
const rowTitles = (section: Locator) => section.getByTestId("task-planner-row").locator(".pv-grouprow-title");
const plannerRow = (section: Locator, title: string) =>
  section.getByTestId("task-planner-row").filter({ has: section.page().locator(".pv-grouprow-title", { hasText: new RegExp(`^${escapeRe(title)}$`) }) });

const HOUSEHOLD = "# Haushalt\n\n- [ ] Drucker einrichten 📅 2026-09-20\n- [/] Keller entrümpeln\n- [x] Brief eingeworfen 📅 2026-09-17\n- [ ] Kuchen backen ⏫ 📅 2026-09-22\n";

test("the planner: Today with Overdue on top, Upcoming by day, Inbox, All and Done — both sources, and a tick writes the file", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  try {
    await start(page, context, sql, [
      ["Aufgaben.base", TASK_BASE],
      ["Aufgaben/Steuer abgeben.md", taskNote("Steuer abgeben", { status: "Offen", frist: "2026-09-18" })],
      ["Aufgaben/Angebot schicken.md", taskNote("Angebot schicken", { status: "Offen", frist: "2026-09-20T14:00" })],
      ["Aufgaben/Zahnarzt anrufen.md", taskNote("Zahnarzt anrufen", { status: "Offen", frist: "2026-09-20", priority: "High" })],
      ["Aufgaben/Bericht schreiben.md", taskNote("Bericht schreiben", { status: "In Arbeit", frist: "2026-09-23" })],
      ["Aufgaben/Reifen wechseln.md", taskNote("Reifen wechseln", { status: "Offen", frist: "2026-10-30" })],
      ["Aufgaben/Irgendwann aufräumen.md", taskNote("Irgendwann aufräumen", { status: "Offen" })],
      ["Aufgaben/Fenster putzen.md", taskNote("Fenster putzen", { status: "Erledigt", frist: "2026-09-19" })],
      ["Haushalt.md", HOUSEHOLD],
    ]);
    await openTasks(page);

    // The screen opens on Today, and its segment counts what is late with it.
    const todayTab = page.getByTestId("tasks-list-today");
    await expect(todayTab).toHaveAttribute("aria-checked", "true");
    await expect(todayTab).toHaveText("Today 4", { timeout: 20_000 });
    const overdue = page.getByTestId("task-planner-section-overdue");
    const today = page.getByTestId("task-planner-section-today");
    await expect(rowTitles(overdue)).toHaveText(["Steuer abgeben"]);
    // Priority first, then the clock, then the name — database entries and
    // checkboxes from a note side by side.
    await expect(rowTitles(today)).toHaveText(["Zahnarzt anrufen", "Angebot schicken", "Drucker einrichten"]);
    await expect(plannerRow(today, "Zahnarzt anrufen")).toHaveAttribute("data-source", "database");
    await expect(plannerRow(today, "Drucker einrichten")).toHaveAttribute("data-source", "note");
    await expect(plannerRow(today, "Zahnarzt anrufen").getByTestId("task-priority-flag")).toHaveAttribute("data-priority", "1");
    // Inside a day the day is the heading; a row adds only its time.
    await expect(plannerRow(today, "Angebot schicken")).toContainText("02:00 PM");
    await expect(plannerRow(today, "Drucker einrichten").locator(".pv-planner-source")).toHaveText("Haushalt");
    await expect(page.getByTestId("task-planner-list")).not.toContainText("Bericht schreiben");

    // A tick in the planner writes the note, like the box in "All": the
    // checkbox line gets its done mark and date, the database entry its done status.
    await plannerRow(today, "Drucker einrichten").getByTestId("task-planner-toggle").click();
    await expect.poll(() => readFile(page, "Haushalt.md")).toBe(HOUSEHOLD.replace("- [ ] Drucker einrichten 📅 2026-09-20", "- [x] Drucker einrichten 📅 2026-09-20 ✅ 2026-09-20"));
    await expect(rowTitles(today)).toHaveText(["Zahnarzt anrufen", "Angebot schicken"]);
    await plannerRow(today, "Zahnarzt anrufen").getByTestId("task-planner-toggle").click();
    await expect.poll(() => readFile(page, "Aufgaben/Zahnarzt anrufen.md")).toBe(taskNote("Zahnarzt anrufen", { status: "Erledigt", frist: "2026-09-20", priority: "High" }));
    await expect(rowTitles(today)).toHaveText(["Angebot schicken"]);
    await expect(todayTab).toHaveText("Today 2");

    // Upcoming: one heading per day, fourteen days ahead — the tyres at the end
    // of October are neither urgent nor undated; only "All" shows them.
    await page.getByTestId("tasks-list-upcoming").click();
    const days = page.getByTestId("task-planner-section-day");
    await expect(days).toHaveCount(2);
    await expect(days.nth(0).locator(".pv-grouplabel")).toContainText("Tuesday, September 22");
    await expect(rowTitles(days.nth(0))).toHaveText(["Kuchen backen"]);
    await expect(days.nth(0).getByTestId("task-priority-flag")).toHaveAttribute("data-priority", "1");
    await expect(days.nth(1).locator(".pv-grouplabel")).toContainText("Wednesday, September 23");
    await expect(rowTitles(days.nth(1))).toHaveText(["Bericht schreiben"]);
    await expect(page.getByTestId("task-planner-list")).not.toContainText("Reifen wechseln");

    // Inbox: what is open and has no date, "in progress" included.
    await page.getByTestId("tasks-list-inbox").click();
    const inbox = page.getByTestId("task-planner-section-inbox");
    await expect(rowTitles(inbox)).toHaveText(["Irgendwann aufräumen", "Keller entrümpeln"]);
    await expect(plannerRow(inbox, "Keller entrümpeln")).toHaveAttribute("data-state", "progress");

    // All: the view as it always was — the database section and the notes,
    // with the open/done filter only this list needs.
    await page.getByTestId("tasks-list-all").click();
    await expect(page.getByTestId("task-planner-list")).toHaveCount(0);
    await expect(page.getByTestId("tasks-filter-open")).toHaveAttribute("aria-checked", "true");
    const dbSection = page.getByTestId("task-db-section");
    await expect(dbSection.getByTestId("task-db-row")).toHaveCount(5);
    await expect(dbSection).toContainText("Reifen wechseln");
    await expect(dbSection).not.toContainText("Zahnarzt anrufen");
    await expect(page.getByTestId("task-row").locator(".pv-grouprow-title")).toHaveText(["Keller entrümpeln", "Kuchen backen"]);

    // Done: most recent first, the two ticked a moment ago on top.
    await page.getByTestId("tasks-list-done").click();
    const done = page.getByTestId("task-planner-section-done");
    await expect(rowTitles(done)).toHaveText(["Zahnarzt anrufen", "Drucker einrichten", "Fenster putzen", "Brief eingeworfen"]);

    // The list is remembered for this vault on this device, and comes back with the app.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("plainva-task-view-local") ?? "{}").list)).toBe("done");
    await restart(page);
    await openTasks(page);
    await expect(page.getByTestId("tasks-list-done")).toHaveAttribute("aria-checked", "true");
    await expect(rowTitles(done)).toHaveText(["Zahnarzt anrufen", "Drucker einrichten", "Fenster putzen", "Brief eingeworfen"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("quick capture: New task from another tab opens the sheet, what it read shows before saving, and the note carries every field", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  try {
    await start(page, context, sql, [["Aufgaben.base", TASK_BASE], ["Aufgaben/Steuer abgeben.md", taskNote("Steuer abgeben", { status: "Offen", frist: "2026-09-25" })]]);

    // From the home tab: "New task" in the ＋ menu opens the tasks tab AND its sheet.
    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New task" }).click();
    const sheet = page.getByTestId("task-capture-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("tasks-filters")).toBeVisible();
    const input = sheet.getByTestId("task-capture-input");
    await expect(input).toBeFocused();

    // What the field recognises is a brick before anything is saved…
    await input.fill("Order weekly planners");
    const bricks = sheet.getByTestId("task-capture-bricks");
    await expect(bricks.getByTestId("task-capture-brick-repeat")).toBeVisible();
    // …the quick buttons write into the sentence…
    const quick = sheet.getByTestId("task-capture-quick");
    await quick.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(input).toHaveValue("Order weekly planners tomorrow");
    await expect(bricks.getByTestId("task-capture-brick-date")).toHaveText("Mon, 09/21");
    // …and a brick switched off stays where it was typed, as title: here
    // "weekly" is part of the thing to order, not a rhythm.
    await bricks.getByRole("button", { name: "Do not apply “weekly”" }).click();
    await expect(bricks.getByTestId("task-capture-brick-repeat")).toHaveCount(0);
    await expect(bricks.locator("button.pv-chip--muted", { hasText: "weekly" })).toBeVisible();
    await expect(input).toHaveValue("Order weekly planners tomorrow");
    // Priority goes none → high → medium; the marks stand in the field.
    const priority = quick.getByRole("button", { name: "Priority", exact: true });
    await priority.click();
    await expect(input).toHaveValue("Order weekly planners tomorrow !!!");
    await expect(bricks.getByTestId("task-capture-brick-priority")).toHaveText("Priority: high");
    await priority.click();
    await expect(input).toHaveValue("Order weekly planners tomorrow !!");
    await expect(bricks.getByTestId("task-capture-brick-priority")).toHaveText("Priority: medium");
    // A time from the picker lands in the sentence too.
    await quick.getByRole("button", { name: "Time…", exact: true }).click();
    await sheet.getByTestId("task-capture-time").fill("16:45");
    await expect(input).toHaveValue("Order weekly planners tomorrow !! 16:45");
    await expect(bricks.getByTestId("task-capture-brick-time")).toHaveText("04:45 PM");
    await sheet.getByTestId("task-capture-submit").click();

    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".pv-toast").filter({ hasText: "Task added: Order weekly planners" })).toBeVisible();
    await expect.poll(() => readFile(page, "Aufgaben/Order weekly planners.md")).not.toBeNull();
    const ordered = (await readFile(page, "Aufgaben/Order weekly planners.md"))!;
    expect(ordered).toMatch(/^status: Offen$/m);
    expect(ordered).toMatch(/^frist: "?2026-09-21T16:45"?$/m);
    expect(ordered).toMatch(/^priority: Medium$/m);
    expect(ordered).toMatch(/^# Order weekly planners$/m);
    expect(ordered).not.toContain("repeat");
    expect(ordered).not.toContain("tomorrow");

    // Tomorrow, with its time and its flag, in Upcoming.
    await page.getByTestId("tasks-list-upcoming").click();
    const monday = page.getByTestId("task-planner-section-day").filter({ hasText: "Monday, September 21" });
    await expect(rowTitles(monday)).toHaveText(["Order weekly planners"]);
    await expect(monday.getByTestId("task-planner-row")).toContainText("04:45 PM");
    await expect(monday.getByTestId("task-priority-flag")).toHaveAttribute("data-priority", "2");

    // "+ New task" in All, and Enter saves: date, time, tag and rhythm in one line.
    await page.getByTestId("tasks-list-all").click();
    await page.getByTestId("task-db-new").click();
    await expect(sheet).toBeVisible();
    await input.fill("Call the plumber today 9:30 #home daily");
    await expect(bricks.getByTestId("task-capture-brick-date")).toHaveText("Sun, 09/20");
    await expect(bricks.getByTestId("task-capture-brick-time")).toHaveText("09:30 AM");
    await expect(bricks.getByTestId("task-capture-brick-tag")).toHaveText("#home");
    await expect(bricks.getByTestId("task-capture-brick-repeat")).toBeVisible();
    await input.press("Enter");
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => readFile(page, "Aufgaben/Call the plumber.md")).not.toBeNull();
    const plumber = (await readFile(page, "Aufgaben/Call the plumber.md"))!;
    expect(plumber).toMatch(/^frist: "?2026-09-20T09:30"?$/m);
    expect(plumber).toMatch(/^tags:\n\s+- home$/m);
    expect(plumber).toMatch(/repeat:\n\s+freq: daily/);
    expect(plumber).toMatch(/^# Call the plumber$/m);
    await page.getByTestId("tasks-list-today").click();
    const today = page.getByTestId("task-planner-section-today");
    await expect(rowTitles(today)).toHaveText(["Call the plumber"]);
    await expect(plannerRow(today, "Call the plumber")).toContainText("09:30 AM");
    await expect(plannerRow(today, "Call the plumber")).toContainText("Repeat");

    // A line without a title saves nothing and says why; Cancel closes.
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New task" }).click();
    await expect(sheet).toBeVisible();
    await input.fill("tomorrow");
    await sheet.getByTestId("task-capture-submit").click();
    await expect(sheet.getByRole("alert")).toHaveText("The task needs a title.");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(await listFolder(page, "Aufgaben")).toEqual(["Call the plumber.md", "Order weekly planners.md", "Steuer abgeben.md"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("tasks that exist more than once: the notice, the review sheet, only the empty copies go — and put away it stays away until the set changes", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  await recordShown(context, "task-duplicates-banner");
  const blumen = { uid: "u1" };
  const rechnung = { uid: "u2" };
  const einmalig = { uid: "u3" };
  try {
    await start(page, context, sql, [
      ["Aufgaben.base", TASK_BASE],
      // One task, three notes: the original, a frozen copy, and a copy somebody wrote into.
      ["Aufgaben/Blumen gießen.md", taskNote("Blumen gießen", { status: "Offen", anchor: blumen })],
      ["Aufgaben/Blumen gießen 2.md", taskNote("Blumen gießen", { status: "Erledigt", anchor: blumen })],
      ["Aufgaben/Blumen gießen 3.md", taskNote("Blumen gießen", { status: "Offen", anchor: blumen, body: "Der Farn steht jetzt im Flur." })],
      // A second task whose kept note is NOT the one with the plain name: the
      // reconciler on this device maintains "… 2", and the review asks the
      // phone's PIM cache for it instead of guessing by the name.
      ["Aufgaben/Rechnung zahlen.md", taskNote("Rechnung zahlen", { status: "Offen", anchor: rechnung })],
      ["Aufgaben/Rechnung zahlen 2.md", taskNote("Rechnung zahlen", { status: "Offen", anchor: rechnung, body: "Überwiesen am Freitag." })],
      ["Aufgaben/Einmalig.md", taskNote("Einmalig", { status: "Offen", anchor: einmalig })],
    ]);
    await bindTaskNote(page, "u2", "Aufgaben/Rechnung zahlen 2.md");
    await openTasks(page);

    // Two tasks are claimed by more than one note; the single one does not count.
    await expect(page.getByTestId("task-duplicates-banner")).toHaveText("Tasks that exist more than once: 2", { timeout: 20_000 });
    await page.getByTestId("task-duplicates-review").click();
    const sheet = page.getByTestId("task-duplicates-sheet");
    await expect(sheet).toBeVisible();
    const groups = sheet.getByTestId("task-duplicates").locator("section");
    await expect(groups).toHaveCount(2);
    const notes = (group: Locator) => group.locator("[data-verdict]");
    const verdicts = (group: Locator) => notes(group).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-verdict")));
    await expect(notes(groups.nth(0)).locator(".pv-grouprow-title")).toHaveText(["Blumen gießen", "Blumen gießen 2", "Blumen gießen 3"]);
    expect(await verdicts(groups.nth(0))).toEqual(["kept", "removable", "ownText"]);
    await expect(notes(groups.nth(0)).nth(1)).toContainText("copy with nothing of its own · will be removed");
    await expect(notes(groups.nth(0)).nth(2)).toContainText("text of its own · stays — please review");
    await expect(notes(groups.nth(1)).locator(".pv-grouprow-title")).toHaveText(["Rechnung zahlen 2", "Rechnung zahlen"]);
    expect(await verdicts(groups.nth(1))).toEqual(["kept", "removable"]);

    await expect(sheet.getByTestId("task-duplicates-remove")).toHaveText("Remove copies: 2");
    await sheet.getByTestId("task-duplicates-remove").click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".pv-toast").filter({ hasText: "Copies removed: 2." })).toBeVisible();
    // Exactly the empty copies are gone; the kept notes and the one with its
    // own text stay. (The copy in the version history is not asserted here: a
    // browser's file store keeps a note as text, and the snapshot reads bytes
    // — only the native file systems of the phones hand those out.)
    await expect.poll(() => listFolder(page, "Aufgaben")).toEqual(["Blumen gießen 3.md", "Blumen gießen.md", "Einmalig.md", "Rechnung zahlen 2.md"]);

    // What is left carries text of its own: nothing more to remove, and the
    // notice can be put away…
    await expect(page.getByTestId("task-duplicates-banner")).toHaveText("Tasks that exist more than once: 1");
    await page.getByTestId("task-duplicates-review").click();
    await expect(sheet).toContainText("Nothing can be removed safely");
    await expect(sheet.getByTestId("task-duplicates-remove")).toHaveCount(0);
    await sheet.getByTestId("task-duplicates-putaway").click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("task-duplicates-banner")).toHaveCount(0);

    // …it stays away across a restart, and comes back by itself when the set
    // changes: another task gets a copy while the app is away.
    await restart(page);
    await openTasks(page);
    await writeFiles(page, [["Aufgaben/Einmalig 2.md", taskNote("Einmalig", { status: "Offen", anchor: einmalig })]]);
    await returnToApp(page);
    await expect(page.getByTestId("task-duplicates-banner")).toHaveText("Tasks that exist more than once: 2", { timeout: 20_000 });
    // Since the restart, the put-away set never showed.
    expect(await shown(page, "task-duplicates-banner")).toEqual(["Tasks that exist more than once: 2"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("names with an id (E12): only the ones Plainva gave are offered, Hide holds until the set changes, and the clean-up renames with their links", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  await recordShown(context, "task-names-banner");
  const anchor = (uid: string) => ({ uid, provider: "google", identity: "google:me", list: "L1" });
  const zahnarzt = `Aufgaben/Zahnarzt anrufen — ${legacyHex(anchor("u1"))}.md`;
  const steuer = `Aufgaben/Steuer abgeben — ${legacyHex(anchor("u2"))}.md`;
  const rasen = `Aufgaben/Rasen mähen — ${legacyHex(anchor("u4"))}.md`;
  const baseName = (path: string) => path.split("/").pop()!;
  // Named by a person (the digits are no hash of its anchor), and a note
  // without an anchor at all: neither is Plainva's to rename.
  const foreign = "Aufgaben/Plan — 0123456789abcdef.md";
  const unanchored = `Notizen/Idee — ${legacyHex(anchor("u1"))}.md`;
  try {
    await start(page, context, sql, [
      ["Aufgaben.base", TASK_BASE],
      [zahnarzt, taskNote("Zahnarzt anrufen", { status: "Offen", anchor: anchor("u1") })],
      [steuer, taskNote("Steuer abgeben", { status: "Offen", anchor: anchor("u2") })],
      // The person's own note holds the plain name: the task becomes "… 2".
      ["Aufgaben/Steuer abgeben.md", "# Meine eigene Notiz\n"],
      [foreign, taskNote("Plan", { status: "Offen", anchor: anchor("u3") })],
      [unanchored, "# Idee\n"],
      ["Projekt.md", `# Projekt\n\nErst [[${baseName(zahnarzt).replace(/\.md$/, "")}]] anrufen.\n`],
    ]);
    // The reconciler's stored path, which the clean-up takes along in the same step.
    await bindTaskNote(page, "u1", zahnarzt);
    await openTasks(page);

    const notice = page.getByTestId("task-names-notice");
    await expect(page.getByTestId("task-names-banner")).toHaveText("2 task notes still carry an id in their names", { timeout: 20_000 });
    await expect(notice).toContainText("Plainva can name them after their titles.");
    await expect(notice).toContainText("Links to these notes are updated along with them (here: 1).");
    // Old (struck through) → new, in one fixed order: by the tasks' identities.
    await expect(notice.locator("del[data-testid='task-names-old']")).toHaveText([baseName(zahnarzt), baseName(steuer)]);
    await expect(notice.getByTestId("task-names-new")).toHaveText(["Zahnarzt anrufen.md", "Steuer abgeben 2.md"]);
    // This is what the lists show until then: the name, id and all.
    await page.getByTestId("tasks-list-inbox").click();
    await expect(page.getByTestId("task-planner-section-inbox")).toContainText(baseName(zahnarzt).replace(/\.md$/, ""));

    // Hide: gone — and after a restart it stays gone until the set of names
    // changes: an older device still hands out such a name.
    await notice.getByTestId("task-names-hide").click();
    await expect(notice).toHaveCount(0);
    await restart(page);
    await openTasks(page);
    await writeFiles(page, [[rasen, taskNote("Rasen mähen", { status: "Offen", anchor: anchor("u4") })]]);
    await returnToApp(page);
    await expect(page.getByTestId("task-names-banner")).toHaveText("3 task notes still carry an id in their names", { timeout: 20_000 });
    expect(await shown(page, "task-names-banner")).toEqual(["3 task notes still carry an id in their names"]);
    await expect(notice.getByTestId("task-names-new")).toHaveText(["Zahnarzt anrufen.md", "Steuer abgeben 2.md", "Rasen mähen.md"]);

    // "Clean up names…" asks first; Cancel leaves every file as it is.
    const before = await readTree(page, "Aufgaben");
    await notice.getByTestId("task-names-clean").click();
    await expect(page.getByText("Clean up names?", { exact: true })).toBeVisible();
    await expect(page.getByText(/^3 task notes get their titles as their names; links to them are updated\./)).toBeVisible();
    await expect(page.getByTestId("confirm-act")).toHaveText("Rename");
    await page.getByTestId("confirm-safe").click();
    await expect(page.getByText("Clean up names?", { exact: true })).toHaveCount(0);
    expect(await readTree(page, "Aufgaben")).toEqual(before);

    // Rename: with their text, their links and the stored path.
    await notice.getByTestId("task-names-clean").click();
    await page.getByTestId("confirm-act").click();
    await expect(page.locator(".pv-toast").filter({ hasText: "Task notes renamed: 3" })).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => listFolder(page, "Aufgaben")).toEqual(["Plan — 0123456789abcdef.md", "Rasen mähen.md", "Steuer abgeben 2.md", "Steuer abgeben.md", "Zahnarzt anrufen.md"]);
    expect(await readFile(page, "Aufgaben/Zahnarzt anrufen.md")).toBe(taskNote("Zahnarzt anrufen", { status: "Offen", anchor: anchor("u1") }));
    expect(await readFile(page, "Aufgaben/Steuer abgeben 2.md")).toBe(taskNote("Steuer abgeben", { status: "Offen", anchor: anchor("u2") }));
    expect(await readFile(page, "Aufgaben/Rasen mähen.md")).toBe(taskNote("Rasen mähen", { status: "Offen", anchor: anchor("u4") }));
    expect(await readFile(page, "Aufgaben/Steuer abgeben.md")).toBe("# Meine eigene Notiz\n");
    expect(await readFile(page, foreign)).toBe(taskNote("Plan", { status: "Offen", anchor: anchor("u3") }));
    expect(await readFile(page, unanchored)).toBe("# Idee\n");
    await expect.poll(() => readFile(page, "Projekt.md")).toBe("# Projekt\n\nErst [[Zahnarzt anrufen]] anrufen.\n");
    expect(await sqlAll(page, "SELECT note_path FROM pim_task_state WHERE uid = ?", ["u1"])).toEqual([{ note_path: "Aufgaben/Zahnarzt anrufen.md" }]);
    // Nothing half-done is left for the next start to finish.
    expect(await page.evaluate(() => localStorage.getItem("plainva-task-names-journal-local"))).toBeNull();

    // The lists name the tasks by their titles now.
    await expect(rowTitles(page.getByTestId("task-planner-section-inbox"))).toHaveText(["Plan — 0123456789abcdef", "Rasen mähen", "Steuer abgeben", "Steuer abgeben 2", "Zahnarzt anrufen"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("Create as a task in the share sheet: the shared text and file become a task note in the task database", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  const inbox = await installShareInbox(context);
  const shareId = "5a4e0001-7a5c-4b6e-8d9f-5ba7ed000001";
  // Any bytes do: the import checks them against their hash, not their format.
  const receipt = Buffer.from("receipt of the post office", "utf8");
  try {
    await start(page, context, sql, [["Aufgaben.base", TASK_BASE], ["Aufgaben/Steuer abgeben.md", taskNote("Steuer abgeben", { status: "Offen" })]]);
    await openTasks(page);

    // Something is shared to Plainva from another app; back in the app, it looks into its inbox.
    inbox.share({ id: shareId, text: "Buy stamps\nThe post office closes at six.", files: [{ name: "receipt.png", mime: "image/png", bytes: receipt }] });
    await returnToApp(page);
    const sheet = page.getByTestId("share-inbox");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Buy stamps");
    await expect(sheet).toContainText("receipt.png");

    // The chip makes it a task: the destination is the task database, and no
    // folder has to be chosen. It and "Into the journal" exclude each other.
    const asTask = sheet.getByTestId("share-as-task");
    const toJournal = sheet.getByTestId("share-to-journal");
    await expect(asTask).toHaveAttribute("aria-pressed", "false");
    await asTask.click();
    await expect(asTask).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.locator("p.m-share-preview").filter({ hasText: /\/ Aufgaben$/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Choose folder" })).toHaveCount(0);
    await toJournal.click();
    await expect(asTask).toHaveAttribute("aria-pressed", "false");
    await asTask.click();
    await expect(toJournal).toHaveAttribute("aria-pressed", "false");
    await sheet.getByRole("button", { name: "Import", exact: true }).click();

    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".pv-toast").filter({ hasText: "Shared content saved." })).toBeVisible();
    // The inbox was acknowledged — and only once the note and the file were written.
    expect(inbox.pending()).toEqual([]);
    expect(inbox.acknowledged()).toEqual([{ id: shareId, discard: false }]);

    const attachment = `Attachments/Shared/${shareId}/1-receipt.png`;
    const created = (await listFolder(page, "Aufgaben")).filter((name) => name !== "Steuer abgeben.md");
    expect(created).toHaveLength(1);
    const note = (await readFile(page, `Aufgaben/${created[0]}`))!;
    expect(note).toMatch(/^status: Offen$/m);
    expect(note).toMatch(/^# Buy stamps$/m);
    expect(note).toContain("Buy stamps\nThe post office closes at six.");
    expect(note).toContain(`![[${attachment}]]`);
    const stored = await page.evaluate(async (p) => String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: `vault/${p}`, directory: "DATA" })).data), attachment);
    expect(Buffer.from(stored, "base64").equals(receipt)).toBe(true);
    // The new note opens, the way every import does.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(created[0].replace(/\.md$/, ""));
    await expect(page.locator(".cm-content")).toContainText("The post office closes at six.");

    // It is a task like any other: undated, so the Inbox has it.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await openTasks(page);
    await page.getByTestId("tasks-list-inbox").click();
    await expect(rowTitles(page.getByTestId("task-planner-section-inbox"))).toHaveText([created[0].replace(/\.md$/, ""), "Steuer abgeben"]);
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

const CHORES = "# Haushalt\n\n- [ ] Drucker einrichten 📅 2026-09-19 #buero\n- [ ] Ohne Datum\n";

test("the due day on the phone: a box a finger can hit, a tap on the date opens the date sheet, All to today moves the overdue ones — and both undo (plan Befunde 2026-10-06, W1-W3)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  const tax = (frist: string) => taskNote("Steuer abgeben", { status: "Offen", frist });
  const rent = (frist: string) => taskNote("Miete zahlen", { status: "Offen", frist });
  try {
    await start(page, context, sql, [
      ["Aufgaben.base", TASK_BASE],
      // One with a time of day: only its DAY may change.
      ["Aufgaben/Steuer abgeben.md", tax("2026-09-18T09:15")],
      ["Aufgaben/Miete zahlen.md", rent("2026-09-15")],
      ["Haushalt.md", CHORES],
    ]);
    await openTasks(page);
    const overdue = page.getByTestId("task-planner-section-overdue");
    const today = page.getByTestId("task-planner-section-today");
    // Oldest first: the longest-waiting thing leads.
    await expect(rowTitles(overdue)).toHaveText(["Miete zahlen", "Steuer abgeben", "Drucker einrichten"], { timeout: 20_000 });

    // W1: the box is a 44px target with a 24px glyph — it was a 15px glyph.
    const box = plannerRow(overdue, "Miete zahlen").getByTestId("task-planner-toggle");
    const target = (await box.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect((await box.locator("svg").boundingBox())!.width).toBe(24);

    // W2: the date is a button. A tap opens the date sheet and does NOT open the note.
    await plannerRow(overdue, "Miete zahlen").getByTestId("task-planner-due").click();
    const sheet = page.getByTestId("task-due-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("tasks-filters")).toBeVisible();
    await sheet.getByTestId("task-due-grid-day-2026-09-22").click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => readFile(page, "Aufgaben/Miete zahlen.md")).toBe(rent("2026-09-22"));
    await expect(rowTitles(overdue)).toHaveText(["Steuer abgeben", "Drucker einrichten"]);
    // The notice names the day that was picked and takes the move back.
    const moved = page.locator(".pv-toast").filter({ hasText: "New due date: Tue, 09/22" });
    await moved.locator(".pv-toast-action").click();
    await expect.poll(() => readFile(page, "Aufgaben/Miete zahlen.md")).toBe(rent("2026-09-15"));
    await expect(rowTitles(overdue)).toHaveText(["Miete zahlen", "Steuer abgeben", "Drucker einrichten"]);

    // W3: one tap for the whole section — database entries and a checkbox alike.
    await page.getByTestId("task-planner-overdue-today").click();
    await expect.poll(() => readFile(page, "Aufgaben/Steuer abgeben.md")).toBe(tax("2026-09-20T09:15"));
    await expect.poll(() => readFile(page, "Aufgaben/Miete zahlen.md")).toBe(rent("2026-09-20"));
    await expect.poll(() => readFile(page, "Haushalt.md")).toBe(CHORES.replace("2026-09-19", "2026-09-20"));
    await expect(overdue).toHaveCount(0);
    await expect(rowTitles(today)).toHaveText(["Steuer abgeben", "Drucker einrichten", "Miete zahlen"]);
    await page.locator(".pv-toast").filter({ hasText: "Moved to today: 3" }).locator(".pv-toast-action").click();
    await expect.poll(() => readFile(page, "Aufgaben/Steuer abgeben.md")).toBe(tax("2026-09-18T09:15"));
    await expect.poll(() => readFile(page, "Aufgaben/Miete zahlen.md")).toBe(rent("2026-09-15"));
    await expect.poll(() => readFile(page, "Haushalt.md")).toBe(CHORES);
    await expect(rowTitles(overdue)).toHaveText(["Miete zahlen", "Steuer abgeben", "Drucker einrichten"]);

    // "All": the same box and the same date control in both sections.
    await page.getByTestId("tasks-list-all").click();
    const dbRow = page.getByTestId("task-db-row").filter({ hasText: "Steuer abgeben" });
    expect((await dbRow.getByTestId("task-db-toggle").boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await dbRow.getByTestId("task-db-toggle").locator("svg").boundingBox())!.width).toBe(24);
    await dbRow.getByTestId("task-db-due").click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("task-due-grid-day-2026-09-25").click();
    await expect.poll(() => readFile(page, "Aufgaben/Steuer abgeben.md")).toBe(tax("2026-09-25T09:15"));
    const noteRow = page.getByTestId("task-row").filter({ hasText: "Drucker einrichten" });
    expect((await noteRow.getByTestId("task-toggle").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noteRow.getByTestId("task-due").click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("task-due-grid-day-2026-09-21").click();
    await expect.poll(() => readFile(page, "Haushalt.md")).toBe(CHORES.replace("2026-09-19", "2026-09-21"));

    // The row's own sheet carries the same picker — the way a task without a date gets one.
    const undated = page.getByTestId("task-row").filter({ hasText: "Ohne Datum" });
    const at = (await undated.locator(".pv-grouprow-title").boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: Math.round(at.x + at.width / 2), y: Math.round(at.y + at.height / 2), id: 1 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(750);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await page.locator(".m-sheet").getByRole("button", { name: "Change due date" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("task-due-grid-day-2026-09-20").click();
    await expect.poll(() => readFile(page, "Haushalt.md")).toContain("- [ ] Ohne Datum 📅 2026-09-20\n");
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("the capture sheets offer notes after [[ and tags after # (plan Befunde 2026-10-06, W5)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  try {
    await start(page, context, sql, [
      ["Aufgaben.base", TASK_BASE],
      ["Projekte/Dachsanierung.md", "# Dachsanierung\n\n#kunde #kundentermin\n"],
      ["Projekte/Garten.md", "# Garten\n\n#privat\n"],
    ]);
    await expect.poll(() => sql.count(INDEX, "tags")).toBeGreaterThanOrEqual(3);

    // The task sheet: a tag is completed from the vault's tags and counts as a brick.
    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    await page.getByTestId("capture-fab").click();
    await page.locator(".m-fabmenu-item", { hasText: "New task" }).click();
    const taskSheet = page.getByTestId("task-capture-sheet");
    const input = taskSheet.getByTestId("task-capture-input");
    await expect(input).toBeFocused();
    await input.pressSequentially("Angebot schicken #kun");
    const options = page.getByTestId("inline-suggest-option");
    await expect(options).toHaveText([/^#kunde/, /^#kundentermin/]);
    // A tap takes one — and the keyboard's focus stays in the field.
    await options.nth(1).click();
    await expect(input).toHaveValue("Angebot schicken #kundentermin ");
    await expect(input).toBeFocused();
    await expect(taskSheet.getByTestId("task-capture-brick-tag")).toContainText("kundentermin");
    // `[[` lists notes by title; the link stays part of the title.
    await input.pressSequentially("[[dach");
    await expect(options).toHaveText(["Dachsanierung"]);
    await options.first().click();
    await expect(input).toHaveValue("Angebot schicken #kundentermin [[Dachsanierung]] ");
    await taskSheet.getByTestId("task-capture-submit").click();
    await expect(taskSheet).toHaveCount(0);
    const created = async () => (await readTree(page, "Aufgaben")).find((entry) => entry.text.includes("Dachsanierung"))?.text ?? "";
    await expect.poll(created).toContain("[[Dachsanierung]]");
    expect(await created()).toContain("kundentermin");
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});

test("the Today screen: a tap on a task's date opens the same date sheet, and the notice takes the move back (W2 on the Today screen)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const sql = await installSqlBridge(context);
  const offer = (frist: string) => taskNote("Angebot schicken", { status: "Offen", frist });
  try {
    await start(page, context, sql, [["Aufgaben.base", TASK_BASE], ["Aufgaben/Angebot schicken.md", offer("2026-09-20T14:00")]]);
    await page.locator(".m-tabbar .m-tab", { hasText: "Today" }).click();
    const row = page.getByTestId("today-task-row").filter({ hasText: "Angebot schicken" });
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.getByTestId("today-task-due").click();
    const sheet = page.getByTestId("task-due-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("task-due-grid-day-2026-09-24").click();
    // Only the day moved; the task left the day it was listed under.
    await expect.poll(() => readFile(page, "Aufgaben/Angebot schicken.md")).toBe(offer("2026-09-24T14:00"));
    await expect(row).toHaveCount(0);

    await page.locator(".pv-toast").filter({ hasText: "New due date: Thu, 09/24" }).locator(".pv-toast-action").click();
    await expect.poll(() => readFile(page, "Aufgaben/Angebot schicken.md")).toBe(offer("2026-09-20T14:00"));
    await expect(row).toBeVisible();
    // A tap beside the date still opens the task.
    await row.locator(".pv-grouprow-title").click();
    await expect(page.getByTestId("today-task-row")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Back$/ })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
