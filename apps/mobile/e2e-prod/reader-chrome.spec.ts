import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

for (const options of [{ width: 390, enabled: true }, { width: 1100, enabled: true }, { width: 390, enabled: false }])
test(`reader chrome ${options.width}px auto=${options.enabled} keeps scroll geometry and returns for interaction`, async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: options.width, height: 850 });
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(enabled => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off", readerAutoHide: enabled })), options.enabled);
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async () => (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Long reader.md", data: "# Long reader\n\n" + Array.from({ length: 100 }, (_, i) => `Paragraph ${i} with readable content and a second sentence.`).join("\n\n"), directory: "DATA", encoding: "utf8", recursive: true }));
    await page.reload(); await page.locator(".m-swipe-front").filter({ has: page.getByText("Long reader", { exact: true }) }).first().click();
    const chrome = page.locator(".m-note-chrome"), scroller = page.locator(".m-editor .cm-scroller");
    await expect(page.getByTestId("note-menu")).toBeVisible();
    const geometry = () => scroller.evaluate(el => ({ y: el.getBoundingClientRect().y, h: el.clientHeight }));
    const initial = await geometry();
    await scroller.evaluate(el => { el.scrollTop = 700; });
    if (!options.enabled) { await expect(chrome).not.toHaveClass(/is-away/); return; }
    await expect(chrome).toHaveClass(/is-away/); await expect(page.getByTestId("note-edit")).toHaveClass(/is-away/);
    expect(await geometry()).toEqual(initial);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath(`reading-away-${options.width}.png`) });
    // CodeMirror refines its estimated total height as new lines mount; the
    // viewport geometry above is the invariant controlled by the floating bar.
    if (options.width > 1000) { await expect(page.locator(".m-tabbar--rail")).toBeVisible(); await expect(page.locator(".m-tabbar--rail")).not.toHaveClass(/is-away/); }
    await scroller.evaluate(el => { el.scrollTop -= 1; }); await expect(chrome).not.toHaveClass(/is-away/);
    await scroller.evaluate(el => { el.scrollTop = 760; }); await expect(chrome).toHaveClass(/is-away/);
    await page.getByTestId("note-menu").focus(); await expect(chrome).not.toHaveClass(/is-away/);
    await page.getByTestId("note-menu").click(); await scroller.evaluate(el => { el.scrollTop = 900; });
    await expect(chrome).not.toHaveClass(/is-away/);
    await page.locator(".m-sheet-backdrop").last().click({ position: { x: 3, y: 3 } });
    await page.getByTestId("note-edit").focus(); await expect(chrome).not.toHaveClass(/is-away/);
    await page.getByTestId("note-edit").click(); await expect(page.getByTestId("note-done")).toBeVisible();
    expect(await chrome.evaluate(el => getComputedStyle(el).transitionDuration.split(",").every(v => parseFloat(v) <= 0.001))).toBe(true);
    await page.getByTestId("note-done").click();
    await scroller.evaluate(el => { el.scrollTop = 0; }); await expect(chrome).not.toHaveClass(/is-away/);
    const line = page.locator(".cm-line").filter({ hasText: /^Paragraph 0 / }); await line.dblclick();
    await expect(page.getByTestId("read-selection-bar")).toBeVisible();
    await scroller.evaluate(el => { el.scrollTop = 100; }); await expect(chrome).not.toHaveClass(/is-away/);
  } finally { sql.close(); }
});
