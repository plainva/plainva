import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Holding a board card: the menu OR a move, never both (TestFlight 2026-09-25:
 * "menu and moving collide").
 *
 * The board used to read the meaning of a hold from where the finger lifted:
 * over another column it was a move, over no column it was the menu. A card
 * carried out of the columns and let go therefore opened the menu over a move
 * that had been given up. The rule now is the design language's: one gesture,
 * one meaning - moving begins with movement, the menu comes on release without
 * movement. Driven through CDP touch input, so the gesture is arbitrated the
 * way a finger's is.
 */
const BASE = `filters:
  and:
    - file.folder == "Jobs"
properties:
  note.status:
    displayName: Status
    plainva:
      input: select
      options:
        - value: Open
          color: teal
        - value: Done
          color: gray
views:
  - type: table
    name: Board
    order:
      - note.status
    plainva:
      render: board
      groupBy: status
`;
const note = (title: string, status: string) => `---\nstatus: ${status}\n---\n# ${title}\n`;

/** Longer than the app's one hold duration (LONG_PRESS_MS, 500 ms). */
const HOLD_MS = 750;

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => ({ x, y, radiusX: 10, radiusY: 10, force: 1 });
  return {
    down: (x: number, y: number) => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(x, y)] }),
    async moveTo(fromX: number, fromY: number, x: number, y: number, steps = 8) {
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(fromX + ((x - fromX) * i) / steps, fromY + ((y - fromY) * i) / steps)] });
        await page.waitForTimeout(16);
      }
    },
    up: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
    cancel: () => cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }),
    close: () => cdp.detach(),
  };
}

test("a held card opens its menu only when it was not moved; a carried card moves or stays, and opens nothing", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, [
      ["vault/Jobboard.base", BASE],
      ["vault/Jobs/Alpha.md", note("Alpha", "Open")],
      ["vault/Jobs/Beta.md", note("Beta", "Open")],
      ["vault/Jobs/Gamma.md", note("Gamma", "Done")],
    ] as Array<[string, string]>);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByText(/^Jobboard$/).first().click();

    const card = (title: string) => page.locator(`.m-basecard[data-row-title="${title}"]`);
    await expect(card("Alpha")).toBeVisible({ timeout: 20000 });
    const sheet = page.locator(".m-sheet");
    const ghost = page.locator(".m-board-ghost");
    const centre = async (title: string) => {
      const box = (await card(title).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const finger = await touch(page);

    // 1. Held and released in place: the menu, and no ghost while holding.
    let at = await centre("Alpha");
    await finger.down(at.x, at.y);
    await page.waitForTimeout(HOLD_MS);
    await expect(card("Alpha")).toHaveClass(/is-dragging/);
    await expect(ghost).toHaveCount(0);
    // Nothing opens under a finger that is still down: the menu is the
    // RELEASE. (The row listener of the other views used to open it here.)
    await expect(sheet).toHaveCount(0);
    await finger.up();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".m-sheet-title")).toHaveText("Alpha");
    await page.keyboard.press("Escape");
    if (await sheet.count()) await page.locator(".m-sheet-backdrop").click({ position: { x: 4, y: 4 } });
    await expect(sheet).toHaveCount(0);

    // 2. A finger that trembles is still holding: the menu.
    at = await centre("Alpha");
    await finger.down(at.x, at.y);
    await page.waitForTimeout(HOLD_MS);
    await finger.moveTo(at.x, at.y, at.x + 4, at.y + 3, 3);
    await expect(ghost).toHaveCount(0);
    await finger.up();
    await expect(sheet).toBeVisible();
    await page.locator(".m-sheet-backdrop").click({ position: { x: 4, y: 4 } });
    await expect(sheet).toHaveCount(0);

    // 3. Carried out of every column and let go: no move, and NO menu. This is
    //    the collision - the old rule opened the menu here.
    at = await centre("Alpha");
    const bar = (await page.locator(".m-appbar").first().boundingBox())!;
    await finger.down(at.x, at.y);
    await page.waitForTimeout(HOLD_MS);
    await finger.moveTo(at.x, at.y, bar.x + bar.width / 2, bar.y + bar.height / 2);
    await expect(ghost).toBeVisible();
    await finger.up();
    await expect(ghost).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(sheet).toHaveCount(0);
    await expect(card("Alpha")).toHaveAttribute("data-group-key", "Open");

    // 4. A gesture the system takes back means nothing either.
    at = await centre("Beta");
    await finger.down(at.x, at.y);
    await page.waitForTimeout(HOLD_MS);
    await finger.cancel();
    await page.waitForTimeout(300);
    await expect(sheet).toHaveCount(0);
    await expect(card("Beta")).not.toHaveClass(/is-dragging/);

    // 5. Carried to another column: the card moves there, and no menu opens.
    at = await centre("Alpha");
    const target = (await page.locator('[data-board-key="Done"]').first().boundingBox())!;
    await finger.down(at.x, at.y);
    await page.waitForTimeout(HOLD_MS);
    await finger.moveTo(at.x, at.y, target.x + target.width / 2, target.y + Math.min(target.height / 2, 120), 12);
    await finger.up();
    await expect(card("Alpha")).toHaveAttribute("data-group-key", "Done", { timeout: 15000 });
    await expect(sheet).toHaveCount(0);
    await finger.close();
  } finally {
    await sql.close();
  }
});
