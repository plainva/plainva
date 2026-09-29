import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Issue 110 (E9) on the phone: the app's own vault is visible in the iOS Files
 * app, and a note moved there sits in another folder with the same content.
 * A list drawn before the move still offers the old place; tapping it used to
 * end at "This note could not be found." with nothing else to do. The note is
 * now looked for by the content hash the index stored — against the real
 * index here, no scripted answers: one match written at the same time (a move
 * keeps it) is followed, anything less certain is offered, none leaves the
 * missing state with the stale row already gone.
 */

const NOTE = "# The Markdown Link no. 50\n\nNine editors that stood out.\n";
const INDEX = "plainva-index";

async function write(page: Page, files: Array<[string, string]>) {
  for (const [path, data] of files) {
    await page.evaluate(async ([p, d]) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/" + p, data: d, directory: "DATA", encoding: "utf8", recursive: true });
    }, [path, data]);
    // Distinct modification times: two files written within one millisecond
    // would look like a move to the lookup.
    await page.waitForTimeout(5);
  }
}

/** Outside Plainva: nothing in the app hears about it. */
async function moveOutside(page: Page, from: string, to: string) {
  await page.evaluate(async ([a, b]) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.rename({ from: "vault/" + a, to: "vault/" + b, directory: "DATA", toDirectory: "DATA" });
  }, [from, to]);
}

async function removeOutside(page: Page, path: string) {
  await page.evaluate(async (p) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.deleteFile({ path: "vault/" + p, directory: "DATA" });
  }, path);
}

async function onDisk(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (p) => {
    try {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.stat({ path: "vault/" + p, directory: "DATA" });
      return true;
    } catch {
      return false;
    }
  }, path);
}

async function readVaultFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/" + p, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);
}

/** Turns to editing and types at the end of the open note. */
async function typeIntoNote(page: Page, text: string) {
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText("Nine editors that stood out.");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

/** Away from the app and back: the web shell reports it as a visibility change. */
async function returnToApp(page: Page) {
  await page.evaluate(() => {
    const set = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set(true);
    set(false);
  });
}

type Bridge = Awaited<ReturnType<typeof installSqlBridge>>;
const indexed = (sql: Bridge, path: string) => sql.count(INDEX, `files WHERE path = '${path.replace(/'/g, "''")}' AND sha256 IS NOT NULL`);

/**
 * The failed-load states sit below the note's bar, not under it (the bar
 * floats over a note being read; laid under it, "Moved?" lost its title), and
 * they carry no pencil — there is nothing to edit.
 */
async function expectStateInView(page: Page, text: string) {
  const bar = await page.locator(".m-note-chrome").boundingBox();
  const target = await page.getByText(text, { exact: true }).boundingBox();
  expect(bar).not.toBeNull();
  expect(target).not.toBeNull();
  expect(target!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  await expect(page.getByTestId("note-edit")).toHaveCount(0);
}

/** Seeds the vault, waits until the index knows every file, opens "4 blog". */
async function openBlogFolder(page: Page, sql: Bridge, files: Array<[string, string]>) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await write(page, files);
  await page.reload();
  for (const [path] of files) await expect.poll(() => indexed(sql, path), { timeout: 20_000 }).toBe(1);
  await page.getByRole("button", { name: /^4 blog/ }).first().click();
  const row = page.getByRole("button", { name: /^link-50/ }).first();
  await expect(row).toBeVisible();
  return row;
}

test.describe("a note moved outside Plainva (issue 110)", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  });

  test("the note screen follows the one file with the same content and says where", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/link-50.md", NOTE], ["4 blog/taken/keep.md", "# Keep\n"]]);
      await moveOutside(page, "4 blog/link-50.md", "4 blog/taken/link-50.md");
      await row.click();

      await expect(page.locator(".pv-toast").filter({ hasText: "Moved outside Plainva. The note is now in 4 blog/taken/." })).toBeVisible();
      await expect(page.locator(".cm-content")).toContainText("Nine editors that stood out.");
      await expect(page.getByTestId("note-missing-back")).toHaveCount(0);
      // The index followed too, and nothing was written back at the old place.
      await expect.poll(() => indexed(sql, "4 blog/taken/link-50.md")).toBe(1);
      expect(sql.count(INDEX, "files WHERE path = '4 blog/link-50.md'")).toBe(0);
      expect(await onDisk(page, "4 blog/link-50.md")).toBe(false);
    } finally {
      sql.close();
    }
  });

  test("asks \"Moved?\" instead of guessing when the content exists twice", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [
        ["4 blog/link-50.md", NOTE],
        ["4 blog/drafts/copy.md", NOTE],
        ["4 blog/taken/keep.md", "# Keep\n"],
      ]);
      await moveOutside(page, "4 blog/link-50.md", "4 blog/taken/link-50.md");
      await row.click();

      await expect(page.getByText("Moved?", { exact: true })).toBeVisible();
      await expectStateInView(page, "Moved?");
      const candidates = page.getByTestId("note-moved-candidate");
      await expect(candidates).toHaveText(["4 blog/drafts/copy.md", "4 blog/taken/link-50.md"]);
      await candidates.filter({ hasText: "4 blog/taken/link-50.md" }).click();

      await expect(page.locator(".pv-toast").filter({ hasText: "The note is now in 4 blog/taken/." })).toBeVisible();
      await expect(page.locator(".cm-content")).toContainText("Nine editors that stood out.");
      await expect(page.getByTestId("note-moved-candidate")).toHaveCount(0);
    } finally {
      sql.close();
    }
  });

  test("offers a single look-alike written at another time instead of following it", async ({ page, context }) => {
    // Two untouched notes from one template carry the same content; deleting
    // one outside Plainva is not a move. The screen must not open the other
    // and call it "moved".
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/drafts/draft.md", NOTE], ["4 blog/link-50.md", NOTE]]);
      await removeOutside(page, "4 blog/link-50.md");
      await row.click();

      await expect(page.getByText("Moved?", { exact: true })).toBeVisible();
      await expectStateInView(page, "Moved?");
      await expect(page.getByText("A file with the same content exists elsewhere — is it this one?")).toBeVisible();
      await expect(page.getByTestId("note-moved-candidate")).toHaveText(["4 blog/drafts/draft.md"]);
      await expect(page.locator(".pv-toast").filter({ hasText: "Moved outside Plainva" })).toHaveCount(0);
      await expect(page.locator(".cm-content")).toHaveCount(0);
      // The stale row went all the same; the look-alike is untouched.
      await expect.poll(() => sql.count(INDEX, "files WHERE path = '4 blog/link-50.md'")).toBe(0);
      expect(indexed(sql, "4 blog/drafts/draft.md")).toBe(1);
    } finally {
      sql.close();
    }
  });

  test("a note that is really gone shows the missing state, and its stale row is gone without a tap", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/link-50.md", NOTE], ["4 blog/other.md", "# Other\n"]]);
      await removeOutside(page, "4 blog/link-50.md");
      await row.click();

      await expect(page.getByTestId("note-missing-back")).toBeVisible();
      await expect(page.getByText("This note could not be found.")).toBeVisible();
      await expectStateInView(page, "This note could not be found.");
      await expect.poll(() => sql.count(INDEX, "files WHERE path = '4 blog/link-50.md'")).toBe(0);
      expect(indexed(sql, "4 blog/other.md")).toBe(1);
    } finally {
      sql.close();
    }
  });
});

test.describe("a note that is OPEN while it is moved outside Plainva (issue 110)", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  });

  test("follows its file after the return to the app, and so does its bookmark", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/link-50.md", NOTE], ["4 blog/taken/keep.md", "# Keep\n"]]);
      // A bookmark on the note, in the device-local store the ordinary move rewrites.
      await write(page, [[".plainva/bookmarks.json", JSON.stringify({ items: [{ type: "file", path: "4 blog/link-50.md" }] })]]);
      await row.click();
      await expect(page.locator(".cm-content")).toContainText("Nine editors that stood out.");

      await moveOutside(page, "4 blog/link-50.md", "4 blog/taken/link-50.md");
      // The iOS Files app moved it while Plainva was away; the return re-reads.
      await returnToApp(page);

      await expect(page.locator(".pv-toast").filter({ hasText: "Moved outside Plainva. The note is now in 4 blog/taken/." })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".cm-content")).toContainText("Nine editors that stood out.");
      await expect.poll(async () => JSON.parse((await readVaultFile(page, ".plainva/bookmarks.json")) ?? "{}").items?.map((i: { path: string }) => i.path))
        .toEqual(["4 blog/taken/link-50.md"]);
      expect(await onDisk(page, "4 blog/link-50.md")).toBe(false);
    } finally {
      sql.close();
    }
  });

  test("takes its unsaved text to the new place, never back to the old one", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/link-50.md", NOTE], ["4 blog/taken/keep.md", "# Keep\n"]]);
      await row.click();
      await typeIntoNote(page, " Typed while it moved.");
      // Moved before the autosave: the save finds the file gone and asks.
      await moveOutside(page, "4 blog/link-50.md", "4 blog/taken/link-50.md");

      await expect(page.locator(".pv-toast").filter({ hasText: "The note is now in 4 blog/taken/." })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".cm-content")).toContainText("Typed while it moved.");
      await expect.poll(() => readVaultFile(page, "4 blog/taken/link-50.md")).toContain("Typed while it moved.");
      // No late save puts a copy back at the old place.
      await page.waitForTimeout(2500);
      expect(await onDisk(page, "4 blog/link-50.md")).toBe(false);
    } finally {
      sql.close();
    }
  });

  test("keeps the unsaved text of a note deleted outside Plainva until it is saved back", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      const row = await openBlogFolder(page, sql, [["4 blog/link-50.md", NOTE], ["4 blog/other.md", "# Other\n"]]);
      await row.click();
      await typeIntoNote(page, " Still mine.");
      await removeOutside(page, "4 blog/link-50.md");

      const banner = page.getByTestId("note-vanished");
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner).toContainText("This file was removed outside Plainva. Your unsaved changes are kept here.");
      await expect(page.locator(".cm-content")).toContainText("Still mine.");
      // The autosave does not bring the file back on its own.
      await page.waitForTimeout(2500);
      expect(await onDisk(page, "4 blog/link-50.md")).toBe(false);

      await banner.getByRole("button", { name: "Save here again" }).click();
      await expect(banner).toHaveCount(0);
      await expect.poll(() => readVaultFile(page, "4 blog/link-50.md")).toContain("Still mine.");
    } finally {
      sql.close();
    }
  });
});

/**
 * Issue 110 (E9) for the other files a screen shows: a database and an image
 * follow a proven move like a note does, and fall back to the same "Moved?"
 * and missing states. A database change that finds its file gone never
 * brings the file back at its old place unless the reader says so.
 */
const LINKS_BASE = "views:\n  - type: table\n    name: Links\n";
const DIAGRAM = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="cornflowerblue"/></svg>';

/** Binary files are written as base64, the way an image lands in the vault. */
async function writeBinary(page: Page, path: string, data: string) {
  await page.evaluate(async ([p, d]) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/" + p, data: btoa(d), directory: "DATA", recursive: true });
  }, [path, data]);
  await page.waitForTimeout(5);
}

test.describe("a database or an image moved outside Plainva (issue 110)", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  });

  test("an open database follows its file after the return to the app, and so does its bookmark", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      await openBlogFolder(page, sql, [["4 blog/Links.base", LINKS_BASE], ["4 blog/link-50.md", NOTE], ["4 blog/taken/keep.md", "# Keep\n"]]);
      await write(page, [[".plainva/bookmarks.json", JSON.stringify({ items: [{ type: "file", path: "4 blog/Links.base" }] })]]);
      await page.getByRole("button", { name: /^Links/ }).first().click();
      await expect(page.getByTestId("base-search-toggle")).toBeVisible();

      await moveOutside(page, "4 blog/Links.base", "4 blog/taken/Links.base");
      await returnToApp(page);

      await expect(page.locator(".pv-toast").filter({ hasText: "Moved outside Plainva. The file is now in 4 blog/taken/." })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("base-search-toggle")).toBeVisible();
      await expect(page.getByTestId("base-missing-back")).toHaveCount(0);
      await expect.poll(async () => JSON.parse((await readVaultFile(page, ".plainva/bookmarks.json")) ?? "{}").items?.map((i: { path: string }) => i.path))
        .toEqual(["4 blog/taken/Links.base"]);
      expect(await onDisk(page, "4 blog/Links.base")).toBe(false);
    } finally {
      sql.close();
    }
  });

  test("a database change after its file was deleted outside Plainva waits until it is saved back", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      await openBlogFolder(page, sql, [["4 blog/Links.base", LINKS_BASE], ["4 blog/link-50.md", NOTE]]);
      await page.getByRole("button", { name: /^Links/ }).first().click();
      await expect(page.getByTestId("base-search-toggle")).toBeVisible();
      // Deleted in the Files app while the database is open; nothing reports it.
      await removeOutside(page, "4 blog/Links.base");

      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await page.getByRole("button", { name: /^View options/ }).click();
      await page.getByRole("button", { name: "Add view" }).click();
      await page.locator(".m-sheet-inputrow input").fill("Second");
      await page.keyboard.press("Enter");

      await expect(page.getByText("This file was removed outside Plainva. Your unsaved changes are kept here.")).toBeVisible({ timeout: 20_000 });
      // The change does not bring the file back on its own.
      await page.waitForTimeout(1500);
      expect(await onDisk(page, "4 blog/Links.base")).toBe(false);

      await page.getByTestId("base-restore").click();
      await expect.poll(() => readVaultFile(page, "4 blog/Links.base")).toContain("name: Second");
      await expect(page.getByTestId("base-search-toggle")).toBeVisible();
    } finally {
      sql.close();
    }
  });

  test("an image whose file moved opens at its new place instead of a load error", async ({ page, context }) => {
    const sql = await installSqlBridge(context);
    try {
      await page.goto("/");
      await waitForVaultDirectory(page);
      await writeBinary(page, "4 blog/diagram.svg", DIAGRAM);
      await write(page, [["4 blog/link-50.md", NOTE], ["4 blog/taken/keep.md", "# Keep\n"]]);
      await page.reload();
      for (const path of ["4 blog/diagram.svg", "4 blog/link-50.md", "4 blog/taken/keep.md"]) await expect.poll(() => indexed(sql, path), { timeout: 20_000 }).toBe(1);
      await page.getByRole("button", { name: /^4 blog/ }).first().click();
      const row = page.getByRole("button", { name: /^diagram/ }).first();
      await expect(row).toBeVisible();

      await moveOutside(page, "4 blog/diagram.svg", "4 blog/taken/diagram.svg");
      await row.click();

      await expect(page.locator(".pv-toast").filter({ hasText: "Moved outside Plainva. The file is now in 4 blog/taken/." })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("img", { name: "diagram.svg" })).toBeVisible();
      await expect(page.getByText("Could not load the image.")).toHaveCount(0);
      expect(await onDisk(page, "4 blog/diagram.svg")).toBe(false);
    } finally {
      sql.close();
    }
  });
});
