import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Only web, mail and phone addresses leave the app (Sammelplan § 3.138).
 *
 * The phone's opener handed every scheme but http(s) to `window.open` inside
 * the WebView, and a URL property in a database cell went there unchecked: a
 * `javascript:` value from a synced vault reached it. Now the sink refuses it
 * and says so; a web address still opens. `window.open` is what the web
 * shell's `Browser.open` ends in too, so recording it catches both ways out.
 */
const BASE = `filters:
  and:
    - file.folder == "Links"
properties:
  note.site:
    displayName: Site
    plainva:
      input: url
views:
  - type: table
    name: Table
    order:
      - note.site
`;

const note = (title: string, site: string) => `---\nsite: "${site}"\n---\n# ${title}\n`;

test("a URL cell with a javascript: address does not open and says why; a web address opens", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened!.push(String(url));
      return null;
    }) as typeof window.open;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const files: Array<[string, string]> = [
    ["vault/Linkboard.base", BASE],
    ["vault/Links/Hostile.md", note("Hostile", "javascript:alert(document.domain)")],
    ["vault/Links/Friendly.md", note("Friendly", "https://plainva.com/docs")],
  ];
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, files);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    await page.getByText(/^Linkboard$/).first().click();
    const hostileCell = page.locator("td", { hasText: "javascript:alert(document.domain)" });
    await expect(hostileCell).toBeVisible({ timeout: 20000 });

    // The hostile value: the sheet offers "Open", the sink refuses it.
    await hostileCell.click();
    const openRow = page.locator(".m-sheet button.m-row", { hasText: /^Open$/ });
    await openRow.click();
    await expect(page.locator(".pv-toast").filter({ hasText: "This link was not opened for your safety" })).toBeVisible();
    // Give a late open a moment to show itself — none may come.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual([]);

    // A web address opens as before.
    await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(openRow).toHaveCount(0);
    await page.locator("td", { hasText: "https://plainva.com/docs" }).click();
    await page.locator(".m-sheet button.m-row", { hasText: /^Open$/ }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual(["https://plainva.com/docs"]);
  } finally {
    sql.close();
  }
});
