import { test, expect, type Page } from "@playwright/test";
import { seedExampleNote, type MobileTestGlobals, vaultFolderNames } from "./exampleVault";

/**
 * D1 of the data-safety plan of 2026-11-06, on the phone: there is no trash,
 * so a file is deleted only with a snapshot in its version history — "Deleted
 * files" brings it back from there. Where the snapshot cannot be written (a
 * full phone), the deletion asks "Delete without a backup?"; "Cancel" keeps
 * the file, only "Delete anyway" deletes it. The failure is forced in the
 * browser's file store: its writes into `.plainva/backups` are refused, as a
 * full storage refuses them.
 */

async function start(page: Page) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The browser build keeps its files in IndexedDB; a snapshot is a put of a file under .plainva/backups.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const entry = value as { path?: unknown; type?: unknown } | null;
      if ((window as unknown as { __backupsFail?: boolean }).__backupsFail && entry && typeof entry.path === "string"
        && entry.type === "file" && entry.path.includes("/vault/.plainva/backups/")) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return put.call(this, value, key);
    };
  });
  await page.goto("/");
  await seedExampleNote(page);
}

const backupsFail = (page: Page, on: boolean) => page.evaluate((v) => { (window as unknown as { __backupsFail?: boolean }).__backupsFail = v; }, on);
const exists = (page: Page, path: string) => page.evaluate(async (p) => (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.stat({ path: "vault/" + p, directory: "DATA" as never }).then(() => true, () => false), path);
const snapshots = (page: Page) => page.evaluate(async () => {
  const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
  try {
    return (await fs.readdir({ path: "vault/.plainva/backups", directory: "DATA" as never })).files.map((f) => f.name);
  } catch { return []; }
});

async function deleteFromList(page: Page) {
  // The row itself, inside its swipe frame: it opens the row's sheet.
  const row = page.locator(".m-swipe-front").filter({ hasText: "Example" }).first().getByRole("button").first();
  // An action first, so a "What's new" sheet is out of the way before the row's sheet opens.
  await row.hover();
  await row.dispatchEvent("contextmenu");
  await page.locator(".m-sheet").getByTestId("sheet-delete").click();
  // The ordinary confirmation of a deletion comes first, as always.
  await page.getByTestId("confirm-act").click();
}

test("a deletion whose snapshot works deletes, and the file can come back from it", async ({ page }) => {
  await start(page);
  await deleteFromList(page);
  await expect.poll(() => exists(page, "Example.md")).toBe(false);
  expect((await snapshots(page)).filter((n) => n.startsWith("Example.md."))).toHaveLength(1);
  await expect(page.getByText("Delete without a backup?")).toHaveCount(0);
});

test("without a snapshot it asks; \"Cancel\" keeps the file, \"Delete anyway\" deletes it", async ({ page }) => {
  await start(page);
  await backupsFail(page, true);
  await deleteFromList(page);

  const question = page.locator(".m-sheet").filter({ hasText: "Delete without a backup?" });
  await expect(question).toBeVisible();
  await expect(question).toContainText("Example.md");
  await expect(question).toContainText("There is no trash on the phone");
  // Nothing says the file "was still saved" any more.
  await expect(page.getByText(/was still saved/)).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("delete-without-backup-mobile.png") });
  await question.getByTestId("confirm-safe").click();
  await expect(question).toHaveCount(0);
  expect(await exists(page, "Example.md")).toBe(true);

  await deleteFromList(page);
  await expect(question).toBeVisible();
  await question.getByTestId("confirm-act").click();
  await expect.poll(() => exists(page, "Example.md")).toBe(false);
});

// Sammelplan § 3.175 no. 6: in the browser build "Keep both" and "Delete copy"
// warned "Version snapshot … failed" — its text read of a file stored as text
// threw when read as bytes, the snapshot before deleting the working copy
// failed, and the copy went without one. The copy's snapshot is there now.
test("\"Delete copy\" of a conflict keeps the copy's text as a snapshot, and asks where it cannot", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await page.locator(".m-swipe-front").filter({ hasText: "Example" }).first().click();
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText("A sentence to review.");
  await page.evaluate(async (data) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Example.md", directory: "DATA" as never, encoding: "utf8" as never, data });
  }, "---\ntype: Note\n---\n# Example\n\nForeign text.\n");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("# Example\n\nLocal text.\n");
  await expect.poll(async () => (await vaultFolderNames(page)).filter((n) => n.includes(".CONFLICT-")).length).toBe(1);
  const copy = (await vaultFolderNames(page)).find((n) => n.includes(".CONFLICT-"))!;

  await backupsFail(page, true);
  await page.getByRole("button", { name: "Show differences", exact: true }).click();
  await page.getByTestId("compare-discard").click();
  await page.getByTestId("confirm-act").click();
  const question = page.locator(".m-sheet").filter({ hasText: "Delete without a backup?" });
  await expect(question).toBeVisible();
  await expect(question).toContainText(copy);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("delete-copy-without-backup-mobile.png") });
  await question.getByTestId("confirm-safe").click();
  expect(await exists(page, copy)).toBe(true);
  await expect(page.getByTestId("conflict-compare-sheet")).toBeVisible();

  await backupsFail(page, false);
  await page.getByTestId("compare-discard").click();
  await page.getByTestId("confirm-act").click();
  await expect(page.getByTestId("conflict-compare-sheet")).not.toBeVisible();
  expect(await exists(page, copy)).toBe(false);
  const kept = (await snapshots(page)).filter((n) => n.startsWith(copy + "."));
  expect(kept).toHaveLength(1);
  // A snapshot before a deletion is the file's bytes, kept as such (a Blob in the browser's store).
  const text = await page.evaluate(async (p) => {
    const data = (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.plainva/backups/" + p, directory: "DATA" as never })).data as unknown;
    return data instanceof Blob ? data.text() : String(data);
  }, kept[0]);
  expect(text).toContain("Local text.");
});
