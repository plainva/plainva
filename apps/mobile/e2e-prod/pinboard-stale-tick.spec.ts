import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A tick on a pinboard card finds its line in the note as it is when it is
 * written (Sammelplan § 3.87 Nr. 4). The card is drawn from what the index
 * held, and the tick named the box by its place alone: a note that moved on
 * underneath — a line put on top by another program — got whatever line
 * stood at that place now. Against the real index: the note is changed on
 * disk behind it, the card still shows the old list.
 */
const BOARD = `filters:
  and:
    - file.folder == "Zettel"
views:
  - type: table
    name: Board
    plainva:
      render: pinboard
`;
const SHOPPING = "---\ntype: Note\n---\n# Shopping\n\n- [ ] Milk\n- [x] Bread\n";

const readNote = (page: Page, path: string) =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readFile({ path: `vault/${file}`, directory: "DATA", encoding: "utf8" })).data as string;
  }, path);

test("a card drawn before its note changed ticks its own line or none, never the one now at its place", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  try {
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, [["vault/Sticky board.base", BOARD], ["vault/Zettel/Shopping.md", SHOPPING]] as Array<[string, string]>);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByText(/^Sticky board$/).first().click();

    const card = page.locator("[data-pinboard-card]").filter({ hasText: "Milk" });
    const boxes = card.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(2, { timeout: 20000 });

    // Another program puts a line on top of the list, behind the index's back.
    await page.evaluate(async (data) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Zettel/Shopping.md", data, directory: "DATA", encoding: "utf8" });
    }, SHOPPING.replace("- [ ] Milk", "- [ ] Eggs\n- [ ] Milk"));
    await expect(boxes).toHaveCount(2);
    await boxes.first().click();

    // That place is "Eggs" now: nothing is ticked, the card says so and is
    // drawn anew from the note as it is.
    await expect(page.getByText("The note changed — list refreshed.")).toBeVisible();
    expect(await readNote(page, "Zettel/Shopping.md")).toContain("- [ ] Eggs\n- [ ] Milk\n- [x] Bread");
    await expect(boxes).toHaveCount(3);

    // Drawn from the note as it is, the box ticks its own line.
    await boxes.nth(1).click();
    await expect.poll(() => readNote(page, "Zettel/Shopping.md")).toContain("- [ ] Eggs\n- [x] Milk\n- [x] Bread");
    await page.screenshot({ path: testInfo.outputPath("stale-card-ticked.png") });
  } finally {
    sql.close();
  }
});
