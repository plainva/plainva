import { seedExampleNote } from "./exampleVault";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Comments on the phone, in a vault WITHOUT an encrypted workspace
 * (Nachschaerfung, N5) - against the production bundle, like the smoke check
 * beside it, because the web build is the one place a phone flow runs without
 * a device: explicit note fixtures supply content and the raw adapter writes the bundle.
 *
 * What this pins: the sheet opens from the note menu in a plain vault, a
 * remark is posted and listed, the sheet says "no comments" only while there
 * are none, and a suggestion made in suggest mode is accepted from the sheet
 * and lands in the note. The locked state cannot be produced here - it needs
 * a keyfile in the vault, which the web bundle has no way to write - and is
 * pinned by the screen's and the sheet's unit tests instead.
 */

async function pastTheFirstStart(page: Page) {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "en", motion: "off" }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  await seedExampleNote(page);
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);
}

/** The first remark asks once how it should be signed; the answer lands in the settings (finding 2026-09-09). */
async function answerNamePrompt(page: Page) {
  const input = page.getByPlaceholder(/^Your name$/);
  // Both tests start on a fresh installation. Preparing the durable operation
  // reads its journal before the name prompt opens; isVisible never waits.
  await expect(input).toBeVisible();
  await input.fill("Marco");
  await page.getByRole("button", { name: /^OK$/ }).click();
}

/** Into an explicitly created note; the file list can also contain folders. */
async function openFirstNote(page: Page) {
  const menu = page.getByTestId("note-menu");
  for (let step = 0; step < 3 && !(await menu.isVisible()); step += 1) {
    const row = page.locator(".m-swipe-front").first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
    await page.waitForTimeout(800);
  }
  await expect(menu).toBeVisible({ timeout: 20000 });
}

test("a plain vault has the sheet: a remark is posted from the note menu and listed", async ({ page }) => {
  await pastTheFirstStart(page);
  await openFirstNote(page);

  // The sheet lives behind the note menu (finding: a phone's note is the scarce surface).
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: /^Comments$/ }).click();
  const sheet = page.locator(".pv-sheet");
  await expect(sheet).toBeVisible({ timeout: 10000 });
  await expect(sheet.getByText(/No comments yet/)).toBeVisible();

  // Post, and see it - with no name set the byline falls back honestly.
  await sheet.locator(".pv-comment-compose textarea").fill("a remark from the phone");
  await sheet.locator(".pv-comment-compose button", { hasText: /^Send$/ }).click();
  await answerNamePrompt(page);
  await expect(sheet.locator(".pv-comment-card__body", { hasText: "a remark from the phone" })).toBeVisible({ timeout: 10000 });
  // The reader's own card says "you" (finding 2026-09-09).
  await expect(sheet.locator(".pv-comment-card__name").first()).toHaveText(/^You$/);
  await expect(sheet.getByText(/No comments yet/)).toHaveCount(0);
});

test("a suggestion made in suggest mode is accepted from the sheet and lands in the note", async ({ page }) => {
  await pastTheFirstStart(page);
  await openFirstNote(page);

  // Suggest mode from the note menu: typing changes a copy, the band counts.
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: /^Suggest$/ }).click();
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" plus");
  // By test id: on a phone the band shows the SHORT label ("Send (1)"), the
  // long one is the desktop's (finding 2026-09-19).
  const send = page.getByTestId("suggest-send");
  await expect(send).toBeEnabled({ timeout: 10000 });
  await send.click();
  await answerNamePrompt(page);
  await expect(send).toHaveCount(0, { timeout: 10000 });
  // Sending leaves the editor in writing mode, whose bar has no note menu:
  // "Done" first, then the menu is back.
  await page.getByRole("button", { name: /^Done$/ }).click();

  // The round is in the sheet under "Suggestions"; accepting writes the note.
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: /^Comments$/ }).click();
  const sheet = page.locator(".pv-sheet");
  await expect(sheet).toBeVisible({ timeout: 10000 });
  // The kind switch is a radiogroup; the sheet lands on "Suggestions" by
  // itself when only proposals are open, so this is a no-op then.
  await sheet.getByRole("radio", { name: /^Suggestions/ }).click();
  const accept = sheet.getByRole("button", { name: /^Accept$/ }).first();
  await expect(accept).toBeVisible({ timeout: 10000 });
  await accept.click();
  await expect(accept).toHaveCount(0, { timeout: 10000 });
  await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
  // The note on screen carries the change at once - not only the file
  // (finding 2026-09-09: the view stayed on the old text until reopened).
  await expect(page.locator(".cm-content").first()).toContainText("plus", { timeout: 10000 });
});

/**
 * The suggestion mode on a PHONE (finding 2026-09-19, three screenshots).
 *
 * 1. The band was the desktop's single row: at phone width the sentence was
 *    left a column four characters wide and the note field slid over it.
 * 2. The offer of an unsent copy was rendered between the floating chrome and
 *    the editor, in nobody's measure: under the status bar when the bar had
 *    retreated, hidden behind the bar (and pushing the text down by its own
 *    height) when it had not.
 * 3. A copy that proposed nothing was parked and offered as "0 blocks".
 */
async function enterSuggestMode(page: Page) {
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: /^Suggest$/ }).click();
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("suggest-band")).toBeVisible({ timeout: 10000 });
  return editor;
}

test("the suggestion band takes two rows on a phone and squeezes nothing", async ({ page }) => {
  await pastTheFirstStart(page);
  await openFirstNote(page);
  const editor = await enterSuggestMode(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" plus");
  await expect(page.getByTestId("suggest-send")).toBeEnabled({ timeout: 10000 });

  const layout = await page.getByTestId("suggest-band").evaluate((band) => {
    const box = (sel: string) => band.querySelector(sel)!.getBoundingClientRect();
    return {
      overflow: band.scrollWidth - band.clientWidth,
      text: box(".pv-suggest-band__text"),
      send: box(".pv-suggest-band__send"),
      note: box(".pv-suggest-band__note"),
      discard: box('[data-testid="suggest-discard"]'),
      shortShown: getComputedStyle(band.querySelector(".pv-suggest-band__short")!).display !== "none",
      longShown: getComputedStyle(band.querySelector(".pv-suggest-band__long")!).display !== "none",
    };
  });
  expect(layout.overflow, "the band must not overflow sideways").toBeLessThanOrEqual(0);
  // The sentence keeps a readable column (it was about sixty pixels wide).
  expect(layout.text.width).toBeGreaterThan(140);
  // Row one: sentence and send. Row two: note and discard, below the sentence.
  expect(layout.send.top).toBeLessThan(layout.text.bottom);
  expect(layout.note.top).toBeGreaterThanOrEqual(layout.text.bottom - 1);
  expect(Math.abs(layout.discard.top - layout.note.top)).toBeLessThan(12);
  // Nothing lies over anything: the note field starts right of the band's edge and ends left of "Discard".
  expect(layout.note.right).toBeLessThanOrEqual(layout.discard.left + 1);
  expect(layout.shortShown && !layout.longShown, "a phone shows the short send label").toBe(true);
});

test("an unsent copy is offered INSIDE the chrome: below the bar, above the text, and gone without a gap", async ({ page, context }) => {
  // The parked copy lives in the vault's index database, so this run needs one.
  const sql = await installSqlBridge(context);
  try {
  await pastTheFirstStart(page);
  await openFirstNote(page);
  const editor = await enterSuggestMode(page);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" plus");
  await expect(page.getByTestId("suggest-send")).toBeEnabled({ timeout: 10000 });
  // The park is debounced (500 ms); then leave the note with the copy unsent.
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^Done$/ }).click();
  await page.getByRole("button", { name: /^Back$/ }).first().click();
  await openFirstNote(page);

  const hint = page.getByTestId("suggest-parked");
  await expect(hint).toBeVisible({ timeout: 10000 });
  await expect(hint).toContainText(/1 block/);
  const measure = () => page.evaluate(() => {
    const chrome = document.querySelector(".m-note-chrome")!;
    const bar = chrome.querySelector(".m-appbar")!.getBoundingClientRect();
    const offer = document.querySelector('[data-testid="suggest-parked"]');
    const line = document.querySelector(".m-editor .cm-content .cm-line")!.getBoundingClientRect();
    return {
      inside: !!offer && chrome.contains(offer),
      barBottom: bar.bottom,
      offerTop: offer ? offer.getBoundingClientRect().top : null,
      chromeBottom: chrome.getBoundingClientRect().bottom,
      firstLineTop: line.top,
    };
  });
  const withHint = await measure();
  expect(withHint.inside, "the offer lives inside .m-note-chrome").toBe(true);
  expect(withHint.offerTop!, "the offer starts below the app bar, not behind it").toBeGreaterThanOrEqual(withHint.barBottom - 1);
  expect(withHint.firstLineTop, "the text starts below the chrome, not under it").toBeGreaterThanOrEqual(withHint.chromeBottom - 1);

  await page.getByTestId("suggest-parked-discard").click();
  await expect(hint).toHaveCount(0);
  await page.waitForTimeout(300);
  const after = await measure();
  // The gap the hint left behind was its own height; now the text follows the bar.
  expect(after.firstLineTop - after.chromeBottom, "no gap is left where the offer stood").toBeLessThan(40);
  expect(after.firstLineTop).toBeGreaterThanOrEqual(after.chromeBottom - 1);
  } finally {
    sql.close();
  }
});

test("a copy that proposes nothing is neither parked nor offered", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  try {
  await pastTheFirstStart(page);
  await openFirstNote(page);
  await enterSuggestMode(page);
  // No keystroke at all: the mode's first block count used to schedule a park.
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^Done$/ }).click();
  await page.getByRole("button", { name: /^Back$/ }).first().click();
  await openFirstNote(page);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("suggest-parked")).toHaveCount(0);
  // …and nothing was stored either: the offer's absence is not just a hidden row.
  expect(sql.count("plainva-index", "meta WHERE key LIKE 'suggestion-park:%'")).toBe(0);
  } finally {
    sql.close();
  }
});
