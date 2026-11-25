import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { openSettings, waitForVaultDirectory } from "./exampleVault";

/**
 * "AI in this vault" on the phone (F71 of release 0.9.0, mockup KI-Oberflächen M5): the folder rules are two named
 * columns — to a provider, onto the internet — under one head, every answer under its column; "Change without asking"
 * is a line of its own under the folder only where it holds there, and a folder that takes it from above says so. With
 * the AI off on this phone, the notice leads to the page that switches it on.
 */

async function boot(page: Page, context: BrowserContext, enabled: boolean) {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.addInitScript((enabled) => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
  }, enabled);
  const sql = await installSqlBridge(context);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.goto("/");
  await waitForVaultDirectory(page);
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  return sql;
}

test("the folder rules are two named columns, and “Change without asking” stands under a folder where it holds", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await boot(page, context, true);
  try {
    await page.evaluate(async () => {
      const fs = (globalThis as unknown as { Capacitor: { Plugins: { Filesystem: { writeFile(options: object): Promise<unknown>; mkdir(options: object): Promise<unknown> } } } }).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/.agent/policy.yml", data: 'folders:\n  "/":\n    write: direct\n  "Health/":\n    cloud: deny\n  "Journal/":\n    write: ask\n', directory: "DATA", encoding: "utf8", recursive: true });
    });
    await openSettings(page);
    await page.getByTestId("settings-area-aiVault").click();
    const rows = page.getByTestId("ai-policy-row");
    await expect(rows).toHaveCount(3);
    // Every answer starts under its head.
    const placed = await page.evaluate(() => {
      const head = [...document.querySelectorAll(".m-rulecols-values.m-rulecols > span")].map((el) => Math.round(el.getBoundingClientRect().left));
      const rows = [...document.querySelectorAll('[data-testid="ai-policy-values"]')].map((values) => [...values.children].map((el) => Math.round(el.getBoundingClientRect().left)));
      // A name or an answer longer than its column wraps inside it, never into the next one.
      const spill = [...document.querySelectorAll(".m-rulecols-values > span")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
      return { head, rows, spill, scroll: document.documentElement.scrollWidth - innerWidth };
    });
    expect(placed.head).toHaveLength(2);
    for (const row of placed.rows) expect(row, "every answer under its head").toEqual(placed.head);
    expect(placed.spill, "no column name or answer runs into the next column").toEqual([]);
    expect(placed.scroll, "nothing runs off the screen").toBeLessThanOrEqual(0);
    // The rule that lets the AI change without asking: on the vault, on a folder that takes it from above, not on one that asks.
    await expect(rows.nth(0).getByTestId("ai-policy-direct")).toHaveText("Change without asking: allowed");
    await expect(rows.filter({ hasText: "Health/" }).getByTestId("ai-policy-direct")).toHaveText("Change without asking: as the folder above");
    await expect(rows.filter({ hasText: "Journal/" }).getByTestId("ai-policy-direct")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-policy-columns-mobile.png") });
  } finally {
    sql.close();
  }
});

test("with the AI off on this phone, the notice leads to the page that switches it on", async ({ page, context }) => {
  test.setTimeout(60_000);
  const sql = await boot(page, context, false);
  try {
    await openSettings(page);
    await page.getByTestId("settings-area-aiVault").click();
    await expect(page.getByTestId("settings-ai-vault-off")).toBeVisible();
    await page.getByTestId("settings-ai-vault-open-ai").click();
    await expect(page.getByTestId("settings-ai")).toBeVisible();
  } finally {
    sql.close();
  }
});
