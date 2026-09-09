import { test, expect, type Page } from "@playwright/test";

/**
 * Comments on the phone, in a vault WITHOUT an encrypted workspace
 * (Nachschaerfung, N5) - against the production bundle, like the smoke check
 * beside it, because the web build is the one place a phone flow runs without
 * a device: the welcome vault is seeded, the raw adapter writes the bundle.
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
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);
}

/** Into the first note. The welcome vault seeds folders and notes; every row is a swipe row, and the first may be a folder. */
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
  await expect(sheet.locator(".pv-comment-card__body", { hasText: "a remark from the phone" })).toBeVisible({ timeout: 10000 });
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
  const send = page.getByRole("button", { name: /^Send suggestions/ });
  await expect(send).toBeEnabled({ timeout: 10000 });
  await send.click();
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
