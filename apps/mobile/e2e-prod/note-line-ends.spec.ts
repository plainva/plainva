import { test, expect, type Page } from "@playwright/test";
import { readVaultFile, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A note keeps its line ends when it is edited (maintainer, 2026-10-09) —
 * against the production bundle, with real files in the web shell's storage.
 *
 * Until then a note was the one text file that did not: the first changed
 * character wrote it back with `\n` throughout. For a vault that came from
 * Windows and is kept in Git, that was the difference between one changed
 * line and the whole file. The foreign text files beside it have kept their
 * shape since 2026-10-08 (text-files.spec.ts).
 */
const MARK = String.fromCharCode(0xfeff);
const NOTE = `${MARK}---\r\ntype: Note\r\n---\r\n# From Windows\r\n\r\nFirst paragraph.\r\n\r\nLast line.\r\n`;

async function vaultWith(page: Page, files: Record<string, string>) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path: "vault/" + path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, Object.entries(files));
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

const conflictCopies = (page: Page) => page.evaluate(async () =>
  (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "vault", directory: "DATA" })).files
    .map((file) => file.name).filter((name) => name.includes(".CONFLICT-")));

test("an edit of a note with \\r\\n and a mark changes the edited line, and nothing else in the file", async ({ page }) => {
  await vaultWith(page, { "From Windows.md": NOTE });
  await page.getByText("From Windows", { exact: true }).first().click();
  const editor = page.locator(".cm-content").first();
  await expect(editor).toContainText("First paragraph.", { timeout: 20_000 });

  // Opening and looking writes nothing.
  expect(await readVaultFile(page, "From Windows.md")).toBe(NOTE);

  await page.getByTestId("note-edit").click();
  const writing = page.locator('.cm-content[contenteditable="true"]').first();
  await writing.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("One more line.");
  // The save is debounced; the file tells when it landed.
  await expect.poll(() => readVaultFile(page, "From Windows.md"), { timeout: 15_000 }).toContain("One more line.");

  // Byte for byte: the note as it was, and the typed line behind it. It used
  // to come back with its mark and "\n" in the place of every "\r\n".
  const saved = await readVaultFile(page, "From Windows.md");
  expect(saved).toBe(`${NOTE}One more line.`);
  expect(saved.startsWith(NOTE)).toBe(true);
  expect(/(^|[^\r])\n/.test(saved)).toBe(false);

  // A second line: the line end the editor adds is the note's own.
  await page.keyboard.press("Enter");
  await page.keyboard.type("And another.");
  await expect.poll(() => readVaultFile(page, "From Windows.md"), { timeout: 15_000 }).toContain("And another.");
  expect(await readVaultFile(page, "From Windows.md")).toBe(`${NOTE}One more line.\r\nAnd another.`);

  // One file, saved — not a conflict copy of a note nobody else touched.
  expect(await conflictCopies(page)).toEqual([]);
});

test("a note that arrived with \\n is saved with \\n", async ({ page }) => {
  const unix = "---\ntype: Note\n---\n# From here\n\nFirst paragraph.\n";
  await vaultWith(page, { "From here.md": unix });
  await page.getByText("From here", { exact: true }).first().click();
  await expect(page.locator(".cm-content").first()).toContainText("First paragraph.", { timeout: 20_000 });
  await page.getByTestId("note-edit").click();
  await page.locator('.cm-content[contenteditable="true"]').first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("One more line.");
  await expect.poll(() => readVaultFile(page, "From here.md"), { timeout: 15_000 }).toContain("One more line.");
  const saved = await readVaultFile(page, "From here.md");
  expect(saved).toBe(`${unix}One more line.`);
  expect(saved.includes("\r")).toBe(false);
  expect(await conflictCopies(page)).toEqual([]);
});
