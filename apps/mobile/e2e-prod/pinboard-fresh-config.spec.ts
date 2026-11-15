import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * An open pinboard writes a pin onto the file as it is, never onto the copy it
 * read when it opened (review of the pinboard fix, 15.11.). A delete in the
 * app takes the deleted note out of the board's lists on disk; the board, open
 * all along, wrote its old copy back on the next pin, and the deleted path
 * came back — a new note of that name then took its place.
 */
const BOARD = `filters:
  and:
    - file.folder == "Zettel"
views:
  - type: table
    name: Board
    plainva:
      render: pinboard
      pinboardOrder:
        - "Zettel/Gone.md"
        - "Zettel/Shopping.md"
`;
const note = (title: string) => `---\ntype: Note\n---\n# ${title}\n\nText\n`;
const HOLD_MS = 750;

const readFile = (page: Page, path: string) =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readFile({ path: `vault/${file}`, directory: "DATA", encoding: "utf8" })).data as string;
  }, path);

test("a pin on an open board after its lists were cleaned on disk keeps them clean", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, [["vault/Board.base", BOARD], ["vault/Zettel/Shopping.md", note("Shopping")], ["vault/Zettel/Idea.md", note("Idea")]] as Array<[string, string]>);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByText(/^Board$/).first().click();
    const card = page.locator("[data-pinboard-card]").filter({ hasText: "Idea" });
    await expect(card).toBeVisible({ timeout: 20000 });

    // The delete's clean-up, as it lands on disk while the board is open: the
    // deleted note leaves the list (`dropPinboardRefs`), and nothing tells the board.
    await page.evaluate(async (data) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Board.base", data, directory: "DATA", encoding: "utf8" });
    }, BOARD.replace('        - "Zettel/Gone.md"\n', ""));

    // Held in place: the card's menu, and "Pin". A held pointer (the board
    // reads pointer events of any kind), on the card where it has settled
    // (the masonry lays the cards out once their heights are measured); the
    // click it ends in would open the note behind the menu — this test is
    // about what the pin writes, so that click goes, and a hold the layout
    // moved away from is held again.
    const sheet = page.locator(".m-sheet");
    for (let attempt = 0; attempt < 4 && !(await sheet.isVisible()); attempt++) {
      let box = (await card.boundingBox())!;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(100);
        const again = (await card.boundingBox())!;
        if (again.x === box.x && again.y === box.y) break;
        box = again;
      }
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(HOLD_MS);
      await page.evaluate(() => window.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true }));
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await expect(sheet).toBeVisible();
    await sheet.getByText(/^Pin$/).click();

    await expect.poll(() => readFile(page, "Board.base"), { timeout: 10000 }).toContain("pinboardPinned");
    const written = await readFile(page, "Board.base");
    expect(written).toContain("Zettel/Idea.md");
    expect(written).toContain("Zettel/Shopping.md");
    expect(written).not.toContain("Zettel/Gone.md");
  } finally {
    await sql.close();
  }
});
