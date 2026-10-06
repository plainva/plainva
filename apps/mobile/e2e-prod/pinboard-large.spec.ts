import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A large pinboard shows the cards that are on screen.
 *
 * TestFlight 2026-10-04: "from about 100 entries the pinboard shows its
 * content only after pulling down". Reproduced here with 150 notes of real
 * length: the cards on screen stood as placeholders ("0 of 12 readable") and
 * stayed that way. Two defects made it:
 *
 *  1. The board measured "is this card on screen" against itself - an element
 *     as tall as its cards, so nothing was ever outside it. Every card counted
 *     as visible and the whole board was read at once.
 *  2. The card cache keeps at most 8 MB of text. Reading 150 long notes ran
 *     past that, and the cache made room by dropping the OLDEST cards - the
 *     first ones read, which are the ones at the top of the screen.
 *
 * So this holds both: the cards on screen are readable without a touch
 * whatever the board weighs, and cards far below are not read until they are
 * scrolled to.
 */
const COUNT = 150;
/** ~60 000 characters per note: 150 of them are well past the cache budget. */
const LONG = "A sentence of the entry that makes the note long. ".repeat(1200);

const board = (folder: string) => `filters:
  and:
    - file.folder == "${folder}"
views:
  - type: table
    name: Board
    plainva:
      render: pinboard
`;

const pad = (n: number) => String(n).padStart(3, "0");
const note = (n: number) => `---\ntype: Note\ntags:\n  - ${n % 2 ? "odd" : "even"}\n---\n# Entry ${pad(n)}\n\nBody of entry ${pad(n)}.\n\n${LONG}\n`;

async function openBoard(page: Page, context: BrowserContext) {
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  await page.goto("/");
  await waitForVaultDirectory(page);
  const files: Array<[string, string]> = [["vault/Large board.base", board("Zettel")]];
  for (let n = 1; n <= COUNT; n++) files.push([`vault/Zettel/Entry ${pad(n)}.md`, note(n)]);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, files);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 30000 });
  await close.click();
  await page.getByText(/^Large board$/).first().click();
}

/** The state of the cards whose box is on screen right now, and of all of them. */
const survey = (page: Page) =>
  page.evaluate(() => {
    const height = window.innerHeight;
    const cards = [...document.querySelectorAll<HTMLElement>("[data-pinboard-card]")];
    const seen = cards.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < height;
    });
    return {
      onScreen: seen.length,
      onScreenReady: seen.filter((el) => el.dataset.cardStatus === "ready").length,
      ready: cards.filter((el) => el.dataset.cardStatus === "ready").length,
      total: cards.length,
    };
  });

const allOnScreenReadable = async (page: Page, message: string) => {
  await expect.poll(async () => {
    const s = await survey(page);
    return s.onScreen > 0 && s.onScreenReady === s.onScreen;
  }, { timeout: 30_000, message }).toBe(true);
};

/** The element that scrolls the board: the database page around it. */
const scrollBoardTo = (page: Page, fraction: number) =>
  page.locator(".m-pinboard").evaluate((el, f) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node && !(node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
    if (!node) throw new Error("the board does not scroll");
    node.scrollTo({ top: (node.scrollHeight - node.clientHeight) * f });
  }, fraction);

test("a board of 150 long notes shows the cards on screen, at the top, at the end and after a jump", async ({ page, context }) => {
  test.setTimeout(240_000);
  const sql = await installSqlBridge(context);
  try {
    await openBoard(page, context);
    await expect(page.locator("[data-pinboard-card]")).toHaveCount(COUNT, { timeout: 120_000 });

    // The first screen is readable without a touch...
    await allOnScreenReadable(page, "the cards of the first screen must load without any gesture");
    // ... and stays readable: nothing that loads later may take it away.
    await page.waitForTimeout(1500);
    const first = await survey(page);
    expect(first.onScreenReady).toBe(first.onScreen);
    // Cards far below the screen are not read yet - the board is lazy again.
    expect(first.ready, "only what is near the screen is read").toBeLessThan(COUNT / 2);

    // The far end. Nothing but the scroll - no pull, no refresh.
    await scrollBoardTo(page, 1);
    await allOnScreenReadable(page, "cards scrolled into view must load");

    // The middle, reached in one jump: cards nobody scrolled past slowly.
    await scrollBoardTo(page, 0.5);
    await allOnScreenReadable(page, "cards reached by a jump must load");

    // And back at the top the first cards are read again, though the cache
    // had to let them go in between.
    await scrollBoardTo(page, 0);
    await allOnScreenReadable(page, "the first cards must come back");

    await expect(page.locator('[data-card-status="error"]')).toHaveCount(0);
  } finally {
    await sql.close();
  }
});
