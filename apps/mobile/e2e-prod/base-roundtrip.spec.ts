import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Two findings of the `.base` reference (03.11.), on the phone's config sheet
 * against the real index:
 *
 * - A filter condition Plainva cannot read (`price > 2`, `a && b` deep in a
 *   group) stays in the file but filters nothing. The sheet showed it as
 *   written and said nothing, so the view showed more rows than its filter
 *   reads; now each such entry says it is not applied.
 * - Deleting a view gave the next view the deleted one's native keys (they
 *   were matched by position). The remaining view must keep its own keys and
 *   get none of the deleted one's.
 */
const BASE = `filters:
  and:
    - file.folder == "Shop"
views:
  - type: table
    name: First
    limit: 7
    order:
      - file.name
      - note.status
    filters:
      and:
        - 'status == "open"'
        - price > 2
        - and:
            - 'status == "open"'
            - or:
                - 'a && b'
                - 'status == "done"'
  - type: cards
    name: Second
    image: note.cover
    cardSize: 180
`;

test("an unreadable filter is marked as not applied, and deleting a view leaves the other its own keys", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  const files: Array<[string, string]> = [
    ["vault/Rawfilter.base", BASE],
    ["vault/Shop/Apple.md", "---\nstatus: open\nprice: 3\n---\n# Apple\n"],
    ["vault/Shop/Pear.md", "---\nstatus: done\nprice: 1\n---\n# Pear\n"],
  ];
  const readBase = () => page.evaluate(async () =>
    String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/Rawfilter.base", directory: "DATA", encoding: "utf8" })).data));
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

    await page.getByText(/^Rawfilter$/).first().click();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    const sheet = page.locator(".m-sheet--config");
    await sheet.getByRole("button", { name: /^Filter/ }).click();

    // The loose condition and the group holding `a && b` each say so.
    const notes = sheet.getByTestId("filter-not-applied");
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toHaveText("Not applied: Plainva cannot read this condition, so it filters nothing.");
    await expect(notes.nth(1)).toHaveText("Not applied, because Plainva cannot read it: a && b");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-filter-not-applied.png") });

    // Back to the areas, then delete the first view.
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await sheet.getByRole("button", { name: /^View options/ }).click();
    await sheet.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByTestId("confirm-act").click();

    await expect.poll(readBase, { timeout: 10000 }).not.toContain("name: First");
    const written = await readBase();
    expect(written).toContain("name: Second");
    expect(written).toContain("image: note.cover");
    expect(written).toContain("cardSize: 180");
    expect(written).not.toContain("limit: 7");
    expect(written).toContain("type: cards");
  } finally {
    sql.close();
  }
});
