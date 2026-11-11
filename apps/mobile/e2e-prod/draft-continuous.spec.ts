import { test, expect, type Page } from "./clockedTest";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Typing that never pauses survives the app ending before its save (stability
 * plan R6, the draft journal both shells share): a key every 60 ms, then the
 * page goes at once — before the note saver's 800-ms pause came. The journal
 * wrote while the typing went on (at most every 400 ms), so the next start has
 * the text: in the note, where the leaving page still got it written, or on
 * offer as a draft. Against the production bundle, with real files in the web
 * shell's storage, which a reload keeps.
 */
const NOTE = "# Note\n\nSaved.\n";
const TYPED = "NEVER_PAUSED_TYPING_KEPT_BY_THE_JOURNAL";

async function vaultWithNote(page: Page) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (text) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Note.md", data: text, directory: "DATA" as never, encoding: "utf8" as never, recursive: true });
  }, NOTE);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

const note = (page: Page) => page.evaluate(async () => String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/Note.md", directory: "DATA" as never, encoding: "utf8" as never })).data));

async function openNote(page: Page) {
  await page.getByText("Note", { exact: true }).first().click();
  await expect(page.locator(".cm-content").first()).toContainText("Note", { timeout: 20_000 });
}

test("typing that never pauses survives the app ending before its save", async ({ page }) => {
  await vaultWithNote(page);
  await openNote(page);
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(TYPED, { delay: 60 });
  // The app ends the moment the typing stops.
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await openNote(page);
  const restore = page.getByRole("button", { name: "Restore draft" });
  // At most the last 400 ms of the typing may be missing.
  const kept = TYPED.slice(0, TYPED.length - 8);
  await expect.poll(async () => (await note(page)).includes(kept) || (await restore.isVisible()), { timeout: 20_000 }).toBe(true);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("draft-after-end-mobile.png") });
  if (await restore.isVisible()) await restore.click();
  await expect(page.locator(".cm-content").first()).toContainText(kept);
  await expect.poll(() => note(page), { timeout: 20_000 }).toContain(kept);
});
