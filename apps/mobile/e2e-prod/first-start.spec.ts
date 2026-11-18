import { test, expect, type Page } from "./clockedTest";

/**
 * The phone's first start (plan Oberfläche, O8 / T11, mockup M8 "sinngemäß").
 *
 * A fresh profile, nothing seeded: three ways in, "I already have a vault"
 * with a guide behind it, the tour leading the template sheet, and an empty
 * vault landing on ONE prompt instead of the full Home.
 *
 * The production bundle runs in a browser here, which has no folder access:
 * the sheet offers only the cloud and its guide says so. The Android and iOS
 * versions of the sheet (folder row, Files app) are covered by the unit test of
 * `services/firstStart.ts`; on a device they never ran.
 */

/** The sheet is on top where it is drawn — present in the DOM is not enough. */
async function onTop(page: Page, text: string) {
  const box = await page.locator(".m-sheet").last().getByText(text).first().boundingBox();
  expect(box, `${text} has no box`).not.toBeNull();
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".m-sheet"), [box!.x + box!.width / 2, box!.y + box!.height / 2]);
  expect(hit, `${text} lies under another layer`).toBe(true);
}

async function freshStart(page: Page) {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ language: "de", motion: "off" }));
  });
  await page.goto("/");
  await expect(page.locator(".m-onboarding")).toBeVisible({ timeout: 20000 });
}

test("three ways in, and 'I already have a vault' explains before it leads on", async ({ page }, testInfo) => {
  await freshStart(page);
  await expect(page.getByTestId("onboarding-local")).toBeVisible();
  await expect(page.getByTestId("onboarding-cloud")).toBeVisible();
  await expect(page.getByTestId("onboarding-existing")).toContainText("Ich habe schon einen Vault");
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-first-start.png") });

  await page.getByTestId("onboarding-existing").click();
  const sheet = page.locator(".m-sheet").last();
  await expect(sheet).toContainText("Wo liegt Dein Vault?");
  await expect(sheet).toContainText("Bestehenden Vault verbinden");
  // The first screen stays below its own sheet (it lay above it on the overlay layer).
  await onTop(page, "Bestehenden Vault verbinden");
  await page.waitForTimeout(500); // the sheet slides in
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-existing-vault.png") });

  // Dismissed: no way in was taken, so the first screen stays.
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-onboarding")).toBeVisible();
});

test("under the cards: the import as a link, the website and the guide — as on the desktop's welcome", async ({ page }) => {
  await freshStart(page);
  await expect(page.getByTestId("onboarding-more")).toContainText("plainva.com");
  await expect(page.getByTestId("onboarding-more").getByRole("button", { name: "Handbuch" })).toBeVisible();

  await page.getByTestId("onboarding-import").click();
  await expect(page.locator(".m-onboarding")).toHaveCount(0);
  await expect(page.getByTestId("import-vault-name").or(page.getByText("Schritt 1 von 3")).first()).toBeVisible({ timeout: 15000 });
});

test("starting locally leads with the tour; an empty vault lands on one prompt", async ({ page }, testInfo) => {
  await freshStart(page);
  await page.getByTestId("onboarding-local").click();

  const sheet = page.locator(".m-sheet").last();
  await expect(sheet).toBeVisible({ timeout: 10000 });
  const rows = sheet.locator("button");
  await expect(rows.first()).toContainText("Plainva-Tour");
  await expect(rows.first()).toContainText("Empfohlen für den Einstieg");
  await onTop(page, "Leerer Vault");
  await page.waitForTimeout(500); // the sheet slides in
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-template-sheet.png") });

  await sheet.getByText("Leerer Vault", { exact: true }).click();

  const prompt = page.getByTestId("first-note-create");
  await expect(prompt).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Schreib Deine erste Notiz")).toBeVisible();
  // ONE prompt: the Files/Tags/Databases switch and the listing are not shown.
  await expect(page.getByTestId("navigator-files")).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-first-note.png") });
});
