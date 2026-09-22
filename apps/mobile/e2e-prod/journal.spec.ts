import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The journal on the phone (plan Journal, J4/J5) — the twin of the desktop run
 * in `apps/desktop/e2e/tasks.spec.ts`: capture lands on top of the stream,
 * an entry becomes a task the task screen already knows, and delete has an undo
 * that gives the note back byte for byte.
 *
 * Against the production bundle on purpose: the capture sheet is hosted by the
 * app, the stream by a screen, the rows by the shared package — three pieces
 * that meet in one place, which is where a bundle split shows.
 */

// The first entry runs over several lines: an entry is content and is shown whole, not cut like a label.
const YESTERDAY = "# Saturday\n\n## Journal\n\n- 08:00 Fog over the canal, first frost on the railing, and the far bank gone behind it\n  The heron stood where it stood last year.\n  Took the long way round.\n- 09:12 Called the workshop #client\n- [ ] 10:30 Order the spare part\n\n## Notes\n\nkeep me\n";

const readNote = (page: Page, path: string) => page.evaluate(async (p) => {
  try {
    return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: p, directory: "DATA", encoding: "utf8" })).data);
  } catch { return null; }
}, path);

async function openArea(page: Page, id: "journal" | "tasks", label: RegExp) {
  const tab = page.locator(".m-tabbar .m-tab", { hasText: label });
  if (await tab.count()) await tab.first().click();
  else {
    await page.getByTestId("tab-areas").click();
    await page.getByTestId(`areas-${id}`).click();
  }
}

test("the journal: capture lands on top, an entry becomes a task the task screen knows, delete has an undo", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await page.clock.setFixedTime(new Date("2026-09-20T14:05:00"));
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    if (!localStorage.getItem("plainva-task-view-local")) localStorage.setItem("plainva-task-view-local", JSON.stringify({ version: 1, status: "open", text: "", folder: "", tag: "", dueOnly: false, showHidden: false, list: "all" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/2026-09-19.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, YESTERDAY);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    await openArea(page, "journal", /^Journal$/);
    const screen = page.getByTestId("journal-screen");
    await expect(screen.getByTestId("journal-day")).toHaveCount(1);
    await expect(screen).toContainText("Called the workshop");

    // Capture: the app's sheet, a button saves (Enter is a line break on a soft keyboard).
    await screen.getByTestId("journal-new-entry").click();
    const sheet = page.getByTestId("journal-capture-sheet");
    await expect(sheet).toContainText("Daily note 2026-09-20");
    await sheet.getByTestId("journal-capture-input").fill("Router is in the basement #client");
    await page.screenshot({ path: testInfo.outputPath("journal-capture-sheet.png") });
    await sheet.getByTestId("journal-capture-save").click();
    await expect(sheet).toHaveCount(0);
    // Today's note did not exist: it is created on the way, the heading with it.
    await expect.poll(() => readNote(page, "vault/2026-09-20.md")).toMatch(/## Journal\n\n- 14:05 Router is in the basement #client\n$/);
    await expect(screen.getByTestId("journal-day")).toHaveCount(2);
    await expect(screen.getByTestId("journal-day").first()).toContainText("Router is in the basement");

    // The tag chip filters the stream; "All" takes the filter back.
    await screen.getByTestId("journal-filter-tag").first().click();
    await expect(screen.getByTestId("journal-entry")).toHaveCount(2);
    await screen.getByTestId("journal-filter-all").click();
    await expect(screen.getByTestId("journal-entry")).toHaveCount(4);
    // Every line of the long entry is on screen: the content row's two-line clamp does not apply to an entry.
    const long = screen.getByTestId("journal-entry").filter({ hasText: "Fog over the canal" });
    await expect(long).toContainText("Took the long way round.");
    expect(await long.locator(".pv-grouprow-title").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);

    // Turn the new entry into a task: the sheet reads the list the desktop's menu reads.
    await screen.getByTestId("journal-day").first().getByTestId("journal-entry-menu").click();
    await page.getByTestId("journal-ctx-toTask").click();
    await expect.poll(() => readNote(page, "vault/2026-09-20.md")).toContain("- [ ] 14:05 Router is in the basement #client");
    await expect(screen.getByTestId("journal-day").first().getByTestId("journal-entry-toggle")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("journal-screen.png") });

    // Delete yesterday's plain entry, then take it back: byte for byte what it was.
    await screen.getByTestId("journal-entry").filter({ hasText: "Called the workshop" }).getByTestId("journal-entry-menu").click();
    await page.getByTestId("journal-ctx-delete").click();
    await expect.poll(() => readNote(page, "vault/2026-09-19.md")).not.toContain("Called the workshop");
    await page.locator(".pv-toast").filter({ hasText: "Entry deleted" }).locator(".pv-toast-action").click();
    await expect.poll(() => readNote(page, "vault/2026-09-19.md")).toBe(YESTERDAY);
    await expect(screen).toContainText("Called the workshop");

    // Both task entries stand in the task screen.
    await openArea(page, "tasks", /^Tasks$/);
    await expect(page.getByRole("button", { name: /Router is in the basement/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Order the spare part/ })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { sql.close(); }
});

test("the Today screen shows the day's journal, and its field writes into that day", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await page.clock.setFixedTime(new Date("2026-09-20T08:30:00"));
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/2026-09-20.md", data: "# Sunday\n\n## Journal\n\n- 07:45 Coffee first\n", directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    const tab = page.locator(".m-tabbar .m-tab", { hasText: /^Today$/ });
    if (await tab.count()) await tab.first().click();
    else {
      await page.getByTestId("tab-areas").click();
      await page.getByTestId("areas-today").click();
    }
    const section = page.getByTestId("journal-day-section");
    await expect(section).toContainText("Coffee first");
    // The pen in the heading opens the app's ONE capture surface with this day
    // as its target; the section carries no field of its own since 2026-09-22.
    await expect(section.getByTestId("journal-section-input")).toHaveCount(0);
    await section.getByTestId("journal-section-new").click();
    const sheet = page.getByTestId("journal-capture-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("journal-capture-input").fill("Watered the fern");
    await sheet.getByTestId("journal-capture-save").click();
    await expect.poll(() => readNote(page, "vault/2026-09-20.md")).toBe("# Sunday\n\n## Journal\n\n- 07:45 Coffee first\n- 08:30 Watered the fern\n");
    await expect(sheet).toHaveCount(0);
    await expect(section.getByTestId("journal-entry")).toHaveCount(2);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("journal-today-section.png") });
    // "All days" leads to the stream.
    await section.getByTestId("journal-section-all").click();
    await expect(page.getByTestId("journal-screen")).toContainText("Watered the fern");
  } finally { sql.close(); }
});

test("the day boundary: an entry at 01:30 joins yesterday and keeps its time (plan Journal-Erweiterungen, X2)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  // Half past one in the morning, with this vault's day ending at 04:00.
  await page.clock.setFixedTime(new Date("2026-09-22T01:30:00"));
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The boundary is a VAULT field, so it lives in the vault's own record.
    localStorage.setItem("CapacitorStorage.mobile-vault-local", JSON.stringify({ dayEndsAt: 240 }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/2026-09-21.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, "# Monday\n\n## Journal\n\n- 22:10 Last train home\n");
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    await openArea(page, "journal", /^Journal$/);
    const screen = page.getByTestId("journal-screen");
    // The head of the day that is still collecting says where a line goes now.
    await expect(screen.getByTestId("journal-day").first()).toContainText("until 04:00");

    await page.getByTestId("journal-new-entry").click();
    const sheet = page.getByTestId("journal-capture-sheet");
    await expect(sheet).toBeVisible();
    // The target is YESTERDAY's note, and it exists - so no "will be created".
    await expect(sheet.getByTestId("journal-capture-target")).toContainText("2026-09-21");
    await sheet.getByTestId("journal-capture-input").fill("Could not sleep");
    await sheet.getByTestId("journal-capture-save").click();

    // Yesterday's note took it, stamped with the real clock - not shifted back.
    await expect.poll(() => readNote(page, "vault/2026-09-21.md")).toBe("# Monday\n\n## Journal\n\n- 22:10 Last train home\n- 01:30 Could not sleep\n");
    // And no note was made for the calendar day the clock shows.
    expect(await readNote(page, "vault/2026-09-22.md")).toBeNull();
    await expect(screen.getByTestId("journal-day")).toHaveCount(1);
  } finally { sql.close(); }
});
