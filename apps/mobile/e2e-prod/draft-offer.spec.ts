import { test, expect, type Page } from "@playwright/test";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * An offered draft stays until it is restored or discarded (open-items plan
 * 3.125). The phone's journal held one text per note: whoever kept typing
 * without answering the offer replaced the offered text with the first save
 * and deleted it with the confirmed one — leaving the note lost it. Now the
 * offer has an entry of its own, as on the desktop.
 *
 * Against the production bundle, with real files in the web shell's storage.
 * The draft is laid down as an earlier run of the app (and an earlier version
 * of it) left it: one text per note, in the first journal's shape.
 */
const NOTE = "# Note\n\nSaved.\n";
const LEFT = "# Note\n\nLeft unsaved.\n";

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

async function back(page: Page) {
  await page.getByRole("button", { name: "Back" }).first().click();
  await expect(page.locator(".cm-content")).toHaveCount(0, { timeout: 20_000 });
}

test("an offered draft survives typing on and leaving the note, and goes once it is restored", async ({ page }) => {
  await vaultWithNote(page);
  // Typing once makes the journal folder of this vault; its save clears the entry again.
  await openNote(page);
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("First.");
  await expect.poll(() => note(page), { timeout: 20_000 }).toContain("First.");
  const vaultDir = await page.evaluate(async () => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "drafts", directory: "DATA" as never })).files[0]?.name);
  expect(vaultDir).toBeTruthy();
  await back(page);
  // An earlier run left a draft of the note, in the first journal's shape.
  await page.evaluate(async ({ dir, text }) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
      path: `drafts/${dir}/${btoa("Note.md")}.json`, data: JSON.stringify({ path: "Note.md", text, ts: 1, revision: 4 }),
      directory: "DATA" as never, encoding: "utf8" as never, recursive: true,
    });
  }, { dir: vaultDir!, text: LEFT });

  const restore = page.getByRole("button", { name: "Restore draft" });
  await openNote(page);
  await expect(restore).toBeVisible({ timeout: 20_000 });
  // Typing on without answering the offer, until the typing is saved…
  if (await page.getByTestId("note-edit").isVisible()) await page.getByTestId("note-edit").click();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("Second.");
  await expect.poll(() => note(page), { timeout: 20_000 }).toContain("Second.");
  await page.waitForTimeout(1000);
  await back(page);
  // …and the offer is still there.
  await openNote(page);
  await expect(restore).toBeVisible({ timeout: 20_000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("draft-offer-mobile-survives.png") });
  await restore.click();
  await expect(page.locator(".cm-content").first()).toContainText("Left unsaved.");
  await expect.poll(() => note(page), { timeout: 20_000 }).toBe(LEFT);
  await page.waitForTimeout(1000);
  await back(page);
  // Restored and saved: not offered again, also once the note changes.
  await openNote(page);
  await page.waitForTimeout(1500);
  await expect(restore).toHaveCount(0);
});
