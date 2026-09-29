import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The pinboard's "New entry" on the phone (plan Befunde 2026-09-24, E17): the
 * FAB opens a PAGE with a title and the real editor, and Done leaves the same
 * file the desktop's window leaves — `# Title` and the title as file name,
 * the board's active label taken over (the phone used to drop it) — and the
 * card is on the board when the page closes. Going back from an empty page
 * leaves nothing behind, and an empty board offers the same page in its empty
 * state, as the desktop's does.
 */
const board = (folder: string) => `filters:
  and:
    - file.folder == "${folder}"
views:
  - type: table
    name: Board
    plainva:
      render: pinboard
`;

const note = (title: string, tags: string[]) =>
  `---\ntype: Note\n${tags.length ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n` : ""}---\n# ${title}\n\nText of ${title}\n`;

const listFolder = (page: Page, folder: string) =>
  page.evaluate(async (dir) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readdir({ path: `vault/${dir}`, directory: "DATA" })).files.map((f) => f.name).sort();
  }, folder);

const readNote = (page: Page, path: string) =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    return (await fs.readFile({ path: `vault/${file}`, directory: "DATA", encoding: "utf8" })).data as string;
  }, path);

/**
 * Writes the fixture, starts the app on it and opens the database `name` from
 * the vault's file list. The database is named apart from its folder: the
 * start screen lists recent notes with their folder under them, and a click
 * on the folder's name there opens a note instead of the board.
 */
async function openBoard(page: Page, context: BrowserContext, name: string, files: Array<[string, string]>, dirs: string[] = []) {
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async ({ entries, folders }) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const path of folders) await fs.mkdir({ path, directory: "DATA", recursive: true });
    for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, { entries: files, folders: dirs });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  await page.getByText(new RegExp(`^${name}$`)).first().click();
}

test("the FAB opens the New entry page; Done leaves the note with its title, the active label and a card on the board", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  try {
    await openBoard(page, context, "Sticky board", [
      ["vault/Sticky board.base", board("Zettel")],
      ["vault/Zettel/Shopping.md", note("Shopping", ["errands"])],
      ["vault/Zettel/Idea.md", note("Idea", [])],
    ]);
    const cards = page.locator("[data-pinboard-card]");
    await expect(cards).toHaveCount(2, { timeout: 20000 });
    // The capture card and its row are gone (E14).
    await expect(page.getByTestId("pinboard-capture-row")).toHaveCount(0);

    // Narrow the board by its label, then make the entry under it.
    await page.locator('[data-pinboard-chip="errands"]').click();
    await expect(cards).toHaveCount(1);

    await page.locator(".pv-fab", { hasText: "Entry" }).click();
    const entry = page.getByTestId("pinboard-entry-page");
    await expect(entry).toBeVisible();
    await expect(entry.getByTestId("pinboard-entry-chip")).toHaveText(["#errands"]);
    const title = entry.getByTestId("pinboard-entry-title");
    await expect(title).toBeFocused();
    await title.fill("Groceries");
    await title.press("Enter");
    // Writing: the editor takes the keyboard, the formatting bar docks.
    await expect(page.locator(".m-edit-toolbar")).toBeVisible();
    await page.keyboard.type("Coffee beans");
    await entry.getByTestId("pinboard-entry-done").click();

    // Back on the board: the card is there, under the label it was made with.
    await expect(entry).toHaveCount(0);
    await expect(cards.filter({ hasText: "Groceries" })).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => listFolder(page, "Zettel")).toContain("Groceries.md");
    const saved = await readNote(page, "Zettel/Groceries.md");
    expect(saved).toContain("# Groceries\n");
    expect(saved).toContain("Coffee beans");
    expect(saved).toMatch(/tags:\n\s+- errands/);
    // The timestamp draft travelled as a rename; nothing else is left behind.
    expect(await listFolder(page, "Zettel")).toEqual(["Groceries.md", "Idea.md", "Shopping.md"]);

    // An empty page leaves nothing: open it, go back.
    await page.locator(".pv-fab", { hasText: "Entry" }).click();
    await expect(entry).toBeVisible();
    await expect.poll(async () => (await listFolder(page, "Zettel")).length).toBe(4);
    await page.getByRole("button", { name: /^(Back|Zurück)$/ }).first().click();
    await expect(entry).toHaveCount(0);
    await expect.poll(() => listFolder(page, "Zettel")).toEqual(["Groceries.md", "Idea.md", "Shopping.md"]);
  } finally {
    sql.close();
  }
});

test("an empty board offers New entry in its empty state, and Done puts the first card on it", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  try {
    await openBoard(page, context, "Empty board", [["vault/Empty board.base", board("Leer")]], ["vault/Leer"]);
    const action = page.getByTestId("base-empty-new");
    await expect(action).toBeVisible({ timeout: 20000 });
    await action.click();
    const entry = page.getByTestId("pinboard-entry-page");
    await expect(entry).toBeVisible();
    await entry.getByTestId("pinboard-entry-title").fill("First card");
    await entry.getByTestId("pinboard-entry-done").click();
    await expect(entry).toHaveCount(0);
    await expect(page.locator("[data-pinboard-card]").filter({ hasText: "First card" })).toHaveCount(1, { timeout: 15000 });
    expect(await listFolder(page, "Leer")).toEqual(["First card.md"]);
    expect(await readNote(page, "Leer/First card.md")).toContain("# First card\n");
  } finally {
    sql.close();
  }
});
