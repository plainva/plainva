import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Queries of the Tasks plugin on the phone (plan Tasks-Abfragen, T6): the
 * tester's callout (iPhone, Build 136) draws its open tasks as a tree while
 * reading — reading is the editor without input — a tick writes the task's
 * line, holding a row opens the sheet of the Tasks tab, "Edit query" switches
 * to writing with the query as text, and a broken query shows its error.
 */

const FILES: Record<string, string> = {
  "Bahnhof Nord.md": "# Bahnhof Nord\n\nStand der Initiative.\n\n> [!todo] Offene Todos\n> ```tasks\n> not done\n> tags include #rettediebahn\n> show tree\n> sort by filename reverse\n> ```\n\n- [ ] Offene Todos sammeln #rettediebahn\n\nNächstes Treffen am Donnerstag.\n",
  "Projekte/Bahn.md": "# Bahn-Projekt\n\n- [ ] Petition einreichen #rettediebahn 📅 2026-10-30 ⏫\n  - [ ] Unterschriften zählen\n  - [x] Text schreiben ✅ 2026-10-20\n- [x] Flyer drucken #rettediebahn ✅ 2026-10-25\n- [ ] Pressemitteilung #presse 📅 2026-11-05\n\n## Termine\n\n- [ ] Treffen mit Verband #rettediebahn ⏳ 2026-10-28\n",
  "Vorlagen/Vorlage.md": "---\nplainva:\n  tasks: false\n---\n- [ ] Vorlage-Aufgabe #rettediebahn\n",
  "Morgen.md": "# Morgen\n\n```tasks\nnot done\nsort by colour\n```\n",
};

async function openVaultWith(page: Page) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (files) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of Object.entries(files)) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, FILES);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  await page.waitForTimeout(1500);
  const close = page.getByTestId("whats-new-close");
  if (await close.isVisible()) await close.click();
}

async function openNote(page: Page, title: string) {
  await page.locator(".m-swipe-front").filter({ hasText: new RegExp(`^${title}$`) }).first().click();
  await expect(page.locator(".cm-content").first()).toBeVisible();
}

const readFile = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return String((await fs.readFile({ path: `vault/${p}`, directory: "DATA", encoding: "utf8" })).data);
  }, path);

test.describe("tasks queries on the phone", () => {
  test("the tester's callout: open tasks as a tree while reading, a tick writes the line", async ({ page, context }, testInfo) => {
    const sql = await installSqlBridge(context);
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
    try {
      await openVaultWith(page);
      await openNote(page, "Bahnhof Nord");
      const live = page.locator(".pv-tasksquery-live").first();
      await expect(live).toHaveClass(/cm-callout/);
      const block = live.getByTestId("tasks-query");
      const rows = block.getByTestId("task-planner-row");
      await expect(rows).toHaveCount(6, { timeout: 15000 });
      const starts = ["Vorlage-Aufgabe", "Offene Todos sammeln", "Petition einreichen", "Unterschriften zählen", "Text schreiben", "Treffen mit Verband"];
      const titles = await rows.allTextContents();
      expect(titles.map((t) => starts.find((s) => t.startsWith(s)) ?? t)).toEqual(starts);
      await expect(block.getByTestId("tasks-query-count")).toHaveText("4 tasks");
      if (process.env.PLAINVA_EVIDENCE) {
        await live.screenshot({ path: testInfo.outputPath("phone-tester-callout-light.png") });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForTimeout(400);
        await live.screenshot({ path: testInfo.outputPath("phone-tester-callout-dark.png") });
        await page.emulateMedia({ colorScheme: "light" });
      }

      // A task of another note: written through the vault.
      await rows.filter({ hasText: "Petition einreichen" }).getByTestId("task-planner-toggle").click();
      await expect.poll(() => readFile(page, "Projekte/Bahn.md")).toMatch(/- \[x\] Petition einreichen #rettediebahn 📅 2026-10-30 ⏫ ✅ \d{4}-\d{2}-\d{2}/);

      // Holding a row opens the sheet of the Tasks tab.
      const row = rows.filter({ hasText: "Treffen mit Verband" }).first();
      const box = await row.boundingBox();
      if (!box) throw new Error("no row");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      const sheet = page.locator(".m-sheet").last();
      await expect(sheet).toContainText("Treffen mit Verband");
      await expect(sheet).toContainText(/Change due date/);
      await expect(sheet).toContainText(/Set priority/);
      await expect(sheet).not.toContainText(/database/i);
    } finally {
      sql.close();
    }
  });

  test("a tick on a task of the same note goes through the editor; Edit query switches to writing", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
    try {
      await openVaultWith(page);
      await openNote(page, "Bahnhof Nord");
      const block = page.locator(".pv-tasksquery-live").first().getByTestId("tasks-query");
      await expect(block.getByTestId("task-planner-row")).toHaveCount(6, { timeout: 15000 });
      await block.getByTestId("task-planner-row").filter({ hasText: "Offene Todos sammeln" }).getByTestId("task-planner-toggle").click();
      await expect.poll(() => readFile(page, "Bahnhof Nord.md"), { timeout: 10000 }).toContain("- [x] Offene Todos sammeln");
      expect(await readFile(page, "Bahnhof Nord.md")).toContain("> ```tasks\n> not done\n");

      await page.locator(".pv-tasksquery-live").first().getByTestId("tasks-query-edit").click();
      await expect(page.locator(".cm-content").first()).toContainText("sort by filename reverse");
      await expect(page.locator(".cm-content").first()).toHaveAttribute("contenteditable", "true");
    } finally {
      sql.close();
    }
  });

  test("a query the Tasks plugin does not understand either shows the line and why", async ({ page, context }, testInfo) => {
    const sql = await installSqlBridge(context);
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
    try {
      await openVaultWith(page);
      await openNote(page, "Morgen");
      const block = page.locator(".pv-tasksquery-live").first().getByTestId("tasks-query");
      await expect(block).toHaveAttribute("data-status", "error");
      await expect(block.getByTestId("tasks-query-error")).toContainText("Line 2");
      await expect(block.getByTestId("tasks-query-error")).toContainText("sort by colour");
      await expect(block.getByTestId("task-planner-row")).toHaveCount(0);
      if (process.env.PLAINVA_EVIDENCE) await block.screenshot({ path: testInfo.outputPath("phone-error.png") });
    } finally {
      sql.close();
    }
  });
});
