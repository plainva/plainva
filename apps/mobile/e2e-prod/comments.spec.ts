import { test, expect, type Page } from "@playwright/test";

/**
 * Comments on the phone, in a vault WITHOUT an encrypted workspace
 * (Nachschaerfung, N5) - against the production bundle, like the smoke check
 * beside it, because the web build is the one place a phone flow runs without
 * a device: the welcome vault is seeded, the raw adapter writes the bundle.
 *
 * What this pins: the sheet opens from the note menu in a plain vault, a
 * remark is posted and listed, and the sheet says "no comments" only while
 * there are none. The locked state cannot be produced here - it needs a
 * keyfile in the vault, which the web bundle has no way to write - and is
 * pinned by the sheet's unit test instead.
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

test("a plain vault has the sheet: a remark is posted from the note menu and listed", async ({ page }) => {
  await pastTheFirstStart(page);

  // The welcome vault seeds folders and notes; every row is a swipe row. The
  // first row may be a folder - stepping into it puts its first note on top.
  const menu = page.getByTestId("note-menu");
  for (let step = 0; step < 3 && !(await menu.isVisible()); step += 1) {
    const row = page.locator(".m-swipe-front").first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
    await page.waitForTimeout(800);
  }
  await expect(menu).toBeVisible({ timeout: 20000 });

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
