import { test, expect, type Page } from "@playwright/test";
import { readVaultFile, seedExampleNote, type MobileTestGlobals, vaultFolderNames } from "./exampleVault";

async function read(page: Page, path: string) {
  return page.evaluate(async path => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/" + path, directory: "DATA", encoding: "utf8" })).data, path);
}
async function openNote(page: Page) {
  // The registered overlay handler owns dismissal. A second close click can
  // resume after the handler has already removed its target.
  const row = page.locator(".m-swipe-front").filter({ hasText: "Example" }).first();
  await expect(row.or(page.getByTestId("note-menu"))).toBeVisible();
  if (await row.isVisible()) await row.click();
  await expect(page.getByTestId("note-menu")).toBeVisible();
}

test("a real mobile conflict keeps one editable local copy through saves, reload and resolution", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  await page.goto("/");
  await seedExampleNote(page);
  await openNote(page);
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText("A sentence to review.");
  const foreign = "---\ntype: Note\n---\n# Example\n\nForeign text.\n";
  await page.evaluate(async data => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Example.md", directory: "DATA", encoding: "utf8", data });
  }, foreign);
  let latest = "";
  for (let revision = 0; revision < 5; revision++) {
    latest = `---\ntype: Note\n---\n# Example\n\nLocal text ${revision}.\n`;
    // Use the editor's selection command, including its frontmatter protection.
    // Native contenteditable fill bypasses CodeMirror's transaction selection.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(latest.slice("---\ntype: Note\n---\n".length));
    await expect.poll(async () => {
      const copies = (await vaultFolderNames(page)).filter(name => name.includes(".CONFLICT-"));
      if (copies.length !== 1) return null;
      return readVaultFile(page, copies[0]);
    }).toBe(latest);
    expect(await read(page, "Example.md")).toBe(foreign);
  }
  await expect(page.getByText("You are editing your conflict copy. It will sync after you merge it.")).toBeVisible();
  await page.reload();
  await openNote(page);
  await page.getByTestId("note-edit").click();
  await expect(editor).toContainText("Local text 4.");
  await page.getByRole("button", { name: "Show differences", exact: true }).click();
  const comparison = page.getByTestId("conflict-compare-sheet");
  await expect(comparison).toContainText("Foreign text.");
  await expect(comparison).toContainText("Local text 4.");
  await comparison.locator("summary").filter({ hasText: "Compare preserved revisions" }).click();
  await page.screenshot({ path: test.info().outputPath("conflict-working-copy-mobile.png"), fullPage: true });
  await page.getByTestId("compare-adopt").click();
  await page.getByRole("button", { name: "Replace file and delete conflict copy", exact: true }).click();
  await expect(comparison).not.toBeVisible();
  expect(await read(page, "Example.md")).toBe(latest);
  const remaining = (await vaultFolderNames(page)).filter(name => name.includes(".CONFLICT-"));
  expect(remaining).toHaveLength(0);
  expect(errors).toEqual([]);
});
