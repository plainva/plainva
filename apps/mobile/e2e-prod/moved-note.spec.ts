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
