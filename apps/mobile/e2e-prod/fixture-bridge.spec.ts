import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The bridge itself, not the app.
 *
 * Every spec here seeds files and reloads. The bridge's databases outlive the
 * page, so a reload that lands inside a transaction used to leave that
 * transaction open: the next document could not begin one, the app carried on
 * without an index, and whichever spec was running waited out its timeout on
 * an empty index and passed on the retry. That is how one cause looked like
 * seventeen unrelated flaky tests. This run does on purpose what timing did by
 * accident, so the cause stays closed.
 */

const INDEX = "plainva-index";

type SqlBridge = { exec(db: string, sql: string, params: unknown[]): Promise<void> };

test("a reload in the middle of a transaction does not cost the next document its index", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
        path: "vault/Abandoned.md", data: "# Abandoned\n\nA note the index has to know after the reload.\n",
        directory: "DATA", encoding: "utf8", recursive: true,
      });
    });

    // Leave a transaction open, the way a document does that is torn down
    // between its BEGIN and its COMMIT. While the app holds one itself the
    // BEGIN is refused, so this waits for its turn: the transaction that is
    // open at the reload is then certainly this one.
    await page.evaluate(async (db) => {
      const bridge = (globalThis as unknown as { __plainvaFixtureSql: SqlBridge }).__plainvaFixtureSql;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const opened = await bridge.exec(db, "BEGIN", []).then(() => true, () => false);
        if (opened) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("the bridge never let a transaction begin");
    }, INDEX);
    await page.reload();

    await expect.poll(() => sql.count(INDEX, "files WHERE path = 'Abandoned.md'"), { timeout: 20_000 }).toBe(1);
    expect(sql.abandonedTransactions()).toBeGreaterThan(0);
  } finally {
    sql.close();
  }
});
