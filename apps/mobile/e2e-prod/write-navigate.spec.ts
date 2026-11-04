import { test as base, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Writing and navigating on the phone (wishes TestFlight 2026-10-25 and
 * 2026-10-28; mockup "Schreiben und Navigieren", S1-S8), in the production
 * bundle on a 375pt phone:
 *  - W2: indent and outdent stand in the keyboard toolbar only while the
 *    caret is in a list, and nest the line the way Tab does;
 *  - W1: the keyboard button at the end puts the keyboard away (the editor
 *    loses focus) and the note stays in writing mode; a second tap brings it back;
 *  - F6: holding Back lists the places behind the note, the tab's root first,
 *    and a tap jumps there;
 *  - F9: the first button of the note bar follows the device setting, and the
 *    bookmark moves into the note menu;
 *  - W3: scrolling a list down takes the bottom bar and the "+" away,
 *    scrolling up brings them back.
 * The edge swipe (W5, iOS only) and the keyboard tuck (F8) need the native
 * shell; their decisions are unit tests.
 */

/** Every test gets the SQLite bridge the search index needs, closed after the test. */
const test = base.extend<{ sqlBridge: void }>({
  sqlBridge: [async ({ context }, use) => {
    const sql = await installSqlBridge(context);
    await use();
    await sql.close();
  }, { auto: true }],
});

const NOTE = "# Plan\n\n- eins\n- zwei\n\nEin Absatz, schreibprobe.\n";

async function boot(page: Page, settings: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript((extra) => {
    if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off", ...extra }));
  }, settings);
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (data) => {
    const files = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    await files.writeFile({ path: "vault/Plan.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    // Enough notes that Home scrolls on a 375pt phone.
    for (let i = 0; i < 40; i += 1) {
      await files.writeFile({ path: `vault/Eintrag ${String(i).padStart(2, "0")}.md`, data: `# Eintrag ${i}\n`, directory: "DATA", encoding: "utf8", recursive: true });
    }
  }, NOTE);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);
}

/** The note, the way a reader finds it: through search. */
async function openPlan(page: Page) {
  await page.getByTestId("appbar-search").first().click();
  await page.getByTestId("appbar-searchpage").locator("input").fill("schreibprobe");
  await page.locator("[data-search-occurrence]").first().click();
  await expect(page.locator(".cm-content")).toContainText("schreibprobe", { timeout: 15000 });
}

test("the keyboard toolbar: indent only in a list, and the keyboard button keeps writing mode", async ({ page }, testInfo) => {
  await boot(page);
  await openPlan(page);
  await page.getByTestId("note-edit").click();
  const content = page.locator(".cm-content");
  await expect(content).toHaveAttribute("contenteditable", "true");

  // Caret in the paragraph: no list buttons.
  await page.locator(".cm-line", { hasText: "schreibprobe" }).click();
  await expect(page.getByTestId("toolbar-indent")).toHaveCount(0);
  // Caret in the second item: both appear, and indent nests the line.
  await page.locator(".cm-line", { hasText: "zwei" }).click();
  await expect(page.getByTestId("toolbar-indent")).toBeVisible();
  await expect(page.getByTestId("toolbar-outdent")).toBeVisible();
  await page.getByTestId("toolbar-indent").click();
  // What the note holds, read from the file once the save has landed.
  await expect.poll(() => page.evaluate(async () => {
    const files = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return String((await files.readFile({ path: "vault/Plan.md", directory: "DATA", encoding: "utf8" })).data);
  }), { timeout: 15000 }).toMatch(/\n[ \t]+- zwei/);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("toolbar-list.png") });
  await page.getByTestId("toolbar-outdent").click();

  // The keyboard button: away and back, writing mode throughout.
  const keyboard = page.getByTestId("toolbar-keyboard");
  await expect(keyboard).toHaveAccessibleName("Hide keyboard");
  await keyboard.click();
  await expect(content).not.toBeFocused();
  await expect(content).toHaveAttribute("contenteditable", "true");
  await expect(keyboard).toHaveAccessibleName("Show keyboard");
  await keyboard.click();
  await expect(content).toBeFocused();
});

test("holding Back lists the places behind the note, and a tap jumps there", async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const back = page.getByTestId("appbar-back").first();
  await back.dispatchEvent("contextmenu");
  const sheet = page.getByTestId("back-history-sheet");
  await expect(sheet).toBeVisible();
  const stops = sheet.getByTestId("back-history-stop");
  // The tab's root first, then the search the note was opened from.
  await expect(stops.first()).toContainText("Home");
  expect(await stops.count()).toBeGreaterThanOrEqual(2);
  await stops.first().click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByTestId("appbar-searchpage")).toHaveCount(0);
});

test("the first button of the note bar follows the device setting", async ({ page }) => {
  await boot(page, { noteHeadButton: "outline" });
  await openPlan(page);
  const head = page.getByTestId("note-head-button");
  await expect(head).toHaveAccessibleName("Outline");
  await expect(page.getByRole("button", { name: "Bookmark", exact: true })).toHaveCount(0);
  // The bookmark is in the note menu instead.
  await page.getByTestId("note-menu").click();
  await expect(page.getByRole("button", { name: "Bookmark" }).first()).toBeVisible();
});

test("scrolling a list down takes the bottom bar away; scrolling up brings it back", async ({ page }) => {
  await boot(page);
  // Home with forty notes is a list long enough to scroll.
  const bar = page.locator(".m-tabbar");
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(bar).not.toHaveClass(/is-hidden/);
  await page.mouse.move(187, 400);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 120);
  await expect(bar).toHaveClass(/is-hidden/);
  await expect(page.locator(".m-fabmenu")).toHaveClass(/is-stepped-aside/);
  await page.mouse.wheel(0, -200);
  await expect(bar).not.toHaveClass(/is-hidden/);
});
