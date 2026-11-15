import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A pin while the search in the database's head narrows the board keeps every
 * card of the view in its lists (0.8.4 to 0.8.7). The board drew what the
 * search let through, and a pin wrote its lists healed to those cards: every
 * other card's place left the .base, and the sync carried it on.
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
        - "Zettel/Shopping.md"
        - "Zettel/Gone.md"
`;
const note = (title: string, body: string) => `---\ntype: Note\n---\n# ${title}\n\n${body}\n`;
const HOLD_MS = 750;

const readFile = (page: Page, path: string) =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readFile({ path: `vault/${file}`, directory: "DATA", encoding: "utf8" })).data as string;
  }, path);

test("a pin while the head search narrows the board keeps every card of the view", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, [["vault/Board.base", BOARD], ["vault/Zettel/Shopping.md", note("Shopping", "Milk")], ["vault/Zettel/Idea.md", note("Idea", "Solar")]] as Array<[string, string]>);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByText(/^Board$/).first().click();
    const cards = page.locator("[data-pinboard-card]");
    await expect(cards).toHaveCount(2, { timeout: 20000 });
    await page.getByTestId("base-search-toggle").click();
    await page.getByTestId("base-search").locator("input").fill("Idea");
    await expect(cards).toHaveCount(1);
    const card = cards.filter({ hasText: "Idea" });

    // Held in place: the card's menu, and "Pin". A held pointer on the card where it
    // has settled; the click it ends in would open the note behind the menu, so that click goes.
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
    // The card the search hid keeps its place; the path whose file is gone goes, as before.
    expect(written).toContain("Zettel/Shopping.md");
    expect(written).not.toContain("Zettel/Gone.md");
  } finally {
    await sql.close();
  }
});

const DRAG_BOARD = `filters:
  and:
    - file.folder == "Zettel"
views:
  - type: table
    name: Board
    plainva:
      render: pinboard
      pinboardOrder:
        - "Zettel/Idea.md"
        - "Zettel/Shopping.md"
        - "Zettel/Panel.md"
`;

test("a drag while the head search narrows the board keeps the hidden cards in their places", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, [["vault/Board.base", DRAG_BOARD], ["vault/Zettel/Shopping.md", note("Shopping", "Milk")], ["vault/Zettel/Idea.md", note("Idea", "Solar")], ["vault/Zettel/Panel.md", note("Panel", "Solar too")]] as Array<[string, string]>);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByText(/^Board$/).first().click();
    const cards = page.locator("[data-pinboard-card]");
    await expect(cards).toHaveCount(3, { timeout: 20000 });
    await page.getByTestId("base-search-toggle").click();
    await page.getByTestId("base-search").locator("input").fill("Solar");
    await expect(cards).toHaveCount(2);
    const settled = async (name: string) => {
      const card = cards.filter({ hasText: name });
      let box = (await card.boundingBox())!;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(100);
        const again = (await card.boundingBox())!;
        if (again.x === box.x && again.y === box.y) break;
        box = again;
      }
      return box;
    };

    // Panel is held, then carried onto the upper half of Idea: it goes before it.
    const from = await settled("Panel");
    const to = await settled("Idea");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 10 });
    await page.evaluate(() => window.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true }));
    await page.mouse.up();

    const order = async () => {
      const yaml = await readFile(page, "Board.base");
      const at = yaml.indexOf("pinboardOrder:");
      const out: string[] = [];
      for (const line of yaml.slice(at).split("\n").slice(1)) {
        const m = line.match(/^\s+- "?([^"]+)"?$/);
        if (!m) break;
        out.push(m[1]!);
      }
      return out;
    };
    await expect.poll(order, { timeout: 10000 }).toEqual(["Zettel/Panel.md", "Zettel/Idea.md", "Zettel/Shopping.md"]);
  } finally {
    await sql.close();
  }
});
