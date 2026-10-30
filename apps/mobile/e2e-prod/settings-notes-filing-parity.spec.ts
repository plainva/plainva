import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * "Notes & filing" on the phone carries the desktop's three vault settings
 * (Sammelplan § 3.169 Nr. 3): "More text files", "Allow Plainva extensions
 * for .base files" and "Mark commented passages in the note" — with the same
 * texts, info buttons and switches, and stored so they stay. Against the
 * production bundle, like the other settings pages. The desktop's rows are
 * the ones `apps/desktop/e2e/smoke.spec.ts` has always shown.
 */

async function shoot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
    await page.screenshot({ path: testInfo.outputPath(`${name}-${mode}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

test("Notes & filing on the phone has the desktop's text files, .base extensions and comment anchors", async ({ context, page }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.getByTestId("settings-area-content").click();

    // More text files: the field, its line and its info.
    const extensions = page.getByTestId("text-file-extensions");
    await extensions.scrollIntoViewIfNeeded();
    await expect(page.getByText("More text files", { exact: true })).toBeVisible();
    await expect(page.getByText("Comma separated, e.g. .log, .ini")).toBeVisible();
    await page.getByRole("button", { name: "More about More text files" }).click();
    await expect(page.getByTestId("rowfield-info-sheet")).toContainText("Extra extensions Plainva opens itself");
    await page.keyboard.press("Escape");
    await extensions.fill("fountain; .adoc");
    await extensions.blur();
    await shoot(page, testInfo, "m-notes-filing-text-files");

    // The .base switch, on by default, as on the desktop.
    const extDb = page.getByTestId("extDb");
    await extDb.scrollIntoViewIfNeeded();
    await expect(page.getByText("Allow Plainva extensions for .base files", { exact: true })).toBeVisible();
    await expect(page.getByText("Obsidian does not fully know these features.")).toBeVisible();
    await expect(extDb).toBeChecked();
    await extDb.click();
    await expect(extDb).not.toBeChecked();

    // Comment anchors, in Annotations, on by default.
    const anchors = page.getByTestId("commentAnchors");
    await anchors.scrollIntoViewIfNeeded();
    await expect(page.getByText("Mark commented passages in the note", { exact: true })).toBeVisible();
    await expect(page.getByText("Writes an invisible HTML comment into the note.")).toBeVisible();
    await expect(anchors).toBeChecked();
    await anchors.click();
    await expect(anchors).not.toBeChecked();
    await shoot(page, testInfo, "m-notes-filing-switches");

    // Stored: leaving the page and coming back shows what was set.
    await back();
    await page.getByTestId("settings-area-content").click();
    await expect(page.getByTestId("text-file-extensions")).toHaveValue("fountain, .adoc");
    await expect(page.getByTestId("extDb")).not.toBeChecked();
    await expect(page.getByTestId("commentAnchors")).not.toBeChecked();
  } finally {
    await sql.close();
  }
});
