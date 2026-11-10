import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A phone screen or sheet that fails takes itself, never the app (stability
 * plan 2026-11-10, R3). Before it, the only boundary sat around the whole app
 * and showed the fatal overlay. Against the production bundle; the areas are
 * made to fail through the boundary's test seam (`__plainvaAreaCrash`, in the
 * e2e build only), everything around them is the real app.
 */

type Seam = { crash(area: string): void; clear(area?: string): void };
const crash = (page: Page, area: string) => page.evaluate((a) => (globalThis as unknown as { __plainvaAreaCrash: Seam }).__plainvaAreaCrash.crash(a), area);
const heal = (page: Page) => page.evaluate(() => (globalThis as unknown as { __plainvaAreaCrash: Seam }).__plainvaAreaCrash.clear());
const note = (page: Page) => page.evaluate(async () => String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/Note.md", directory: "DATA" as never, encoding: "utf8" as never })).data));

async function vaultWithNote(page: Page) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async () => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Note.md", data: "# Note\n\nSaved.\n", directory: "DATA" as never, encoding: "utf8" as never, recursive: true });
  });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

async function openNote(page: Page) {
  await page.getByText("Note", { exact: true }).first().click();
  await expect(page.locator(".cm-content").first()).toContainText("Note", { timeout: 20_000 });
}

async function evidence(page: Page, info: TestInfo, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: info.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("a screen that fails keeps the tab bar, does not loop, and its way back returns", async ({ page }, info) => {
  await vaultWithNote(page);
  await openNote(page);
  await crash(page, "screen:note");

  const fallback = page.getByTestId("area-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("data-area", "screen:note");
  await expect(fallback).toContainText("This area could not be shown");
  // The app is alive: the fatal overlay is not up (the note screen hides the tab bar itself).
  await expect(page.locator("#m-fatal")).toHaveCount(0);
  await evidence(page, info, "screen-fallback");

  await fallback.getByTestId("area-fallback-reload").click();
  await expect(fallback).toHaveAttribute("data-failed-again", "true");
  await expect(fallback.getByTestId("area-fallback-reload")).toHaveCount(0);

  await heal(page);
  await fallback.getByTestId("area-fallback-exit").click();
  await expect(page.getByTestId("area-fallback")).toHaveCount(0);
  // Back on the tab root: the bar and the note in the list.
  await expect(page.locator('[data-testid="nav-settings"]').first()).toBeVisible();
  await expect(page.getByText("Note", { exact: true }).first()).toBeVisible();
});

test("the note's own screen fails: the typed text is saved and comes back with the reload", async ({ page }) => {
  await vaultWithNote(page);
  await openNote(page);
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("Typed before the crash.");
  await crash(page, "screen:note");
  await expect(page.getByTestId("area-fallback")).toBeVisible();
  // The phone journals and saves outside the screen: the text reaches the file.
  await expect.poll(() => note(page), { timeout: 20_000 }).toContain("Typed before the crash.");

  await heal(page);
  await page.getByTestId("area-fallback-reload").click();
  await expect(page.locator(".cm-content").first()).toContainText("Typed before the crash.", { timeout: 20_000 });
});

test("a sheet beside the note fails: the note stays, with its text", async ({ page }, info) => {
  await vaultWithNote(page);
  await openNote(page);
  await page.locator(".cm-content").first().evaluate((el) => el.setAttribute("data-probe", "same-editor"));
  await crash(page, "sheet:noteContext");
  await crash(page, "pane:noteContext");
  await page.getByTestId("note-context").click();
  const fallback = page.locator('[data-area="sheet:noteContext"], [data-area="pane:noteContext"]');
  await expect(fallback.first()).toBeVisible();
  await expect(page.locator('.cm-content[data-probe="same-editor"]')).toContainText("Saved.");
  await evidence(page, info, "sheet-fallback");
});

test("the bar and the floating button fail in their own place and size", async ({ page }, info) => {
  await vaultWithNote(page);
  await expect(page.locator('[data-testid="nav-settings"]').first()).toBeVisible({ timeout: 20_000 });
  await crash(page, "shell:navbar");
  await crash(page, "shell:fab");
  const bar = page.locator('[data-area="shell:navbar"]');
  const fab = page.locator('[data-area="shell:fab"]');
  await expect(bar).toBeVisible();
  await expect(fab).toBeVisible();
  const viewport = page.viewportSize()!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.width).toBeLessThanOrEqual(viewport.width);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewport.height);
  const fabBox = (await fab.boundingBox())!;
  // A failed button is button-sized, not a sentence over the content.
  expect(fabBox.width).toBeLessThanOrEqual(72);
  expect(fabBox.height).toBeLessThanOrEqual(80);
  expect(await fab.textContent()).toBe("");
  expect(fabBox.x + fabBox.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The list itself still opens notes.
  await expect(page.getByText("Note", { exact: true }).first()).toBeVisible();
  await evidence(page, info, "bar-and-fab-fallback");
});
