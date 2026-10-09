import { test, expect, type Page } from "@playwright/test";
import { readVaultFile, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Text files on the phone (C15; finding 2026-10-08) — against the production
 * bundle, with real files in the web shell's storage.
 *
 * The shared rule calls a `.csv` or an `.ini` a text file that opens inside
 * Plainva, and the desktop has treated one that way since 2026-08: opened from
 * anywhere, refused when its bytes are not text, written back with the line
 * ends and the mark it arrived with. The phone opened the same files with none
 * of the three: its file list handed them to the share sheet while a link
 * opened them in the editor, it showed whatever decoded, and one edit turned
 * every `\r\n` of the file into `\n`.
 */
const MARK = String.fromCharCode(0xfeff), NUL = String.fromCharCode(0);
const SETTINGS = `${MARK}[section]\r\nkey=1\r\n`;
const DUMP = `PK${NUL}${NUL}not text at all`;

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

test("a text file opens from the file list, and an edit leaves it with its line ends and its mark", async ({ page }) => {
  await vaultWith(page, { "Settings.ini": SETTINGS });
  // From the LIST: this row used to open the share sheet.
  await page.getByText("Settings.ini", { exact: true }).first().click();
  const editor = page.locator(".cm-content").first();
  await expect(editor).toContainText("key=1", { timeout: 20_000 });

  await page.getByTestId("note-edit").click();
  const writing = page.locator('.cm-content[contenteditable="true"]').first();
  await writing.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("more=2");
  // The save is debounced; the file tells when it landed.
  await expect.poll(() => readVaultFile(page, "Settings.ini"), { timeout: 15_000 }).toContain("more=2");
  // Byte for byte: the mark, every "\r\n", and the new line where it was typed.
  expect(await readVaultFile(page, "Settings.ini")).toBe(`${MARK}[section]\r\nkey=1\r\nmore=2`);
  // One file, saved — not a conflict copy of a file nobody else touched.
  const names = await page.evaluate(async () => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "vault", directory: "DATA" })).files.map((file) => file.name));
  expect(names.filter((name) => name.includes(".CONFLICT-"))).toEqual([]);
});

test("a file that is named like text and is not shows nothing of itself and is offered to another app", async ({ page }) => {
  await vaultWith(page, { "dump.log": DUMP });
  await page.getByText("dump.log", { exact: true }).first().click();
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This file is not text")).toBeVisible();
  await expect(page.getByTestId("note-not-text-share")).toBeVisible();
  // No editor, and no way into one: what it would hold is a lossy decode.
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByTestId("note-edit")).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("not-text-mobile.png") });
  expect(await readVaultFile(page, "dump.log")).toBe(DUMP);
  // The way out is the one every failed load has.
  await page.getByTestId("note-not-text-back").click();
  await expect(page.getByText("dump.log", { exact: true }).first()).toBeVisible();
});
