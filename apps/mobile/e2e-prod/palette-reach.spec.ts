import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The phone's command palette reaches what the phone already served on a
 * screen of its own (parity gap palette-command-reach, closed 2026-10-06).
 *
 * Against the production bundle and the real navigation, because that is where
 * the two faults behind this lived and no unit test could see them: a command
 * that navigates was pushed and popped again in the same breath (the palette
 * left a microtask AFTER the command ran), and a command for "the open note"
 * was never listed at all — the palette is the top of the stack while it
 * lists, so no note counted as open, and the note it covers is not mounted to
 * hear an event.
 */

const VAULT_COMMANDS = ["template-new", "open-comments", "import-pkm", "backup-now", "rebuild-index", "update-indexes"];
const NOTE_COMMANDS = [
  "version-history", "insert-template", "template-from-note", "toggle-source", "mail-mailto", "mail-draft",
  // The three the phone had before — built, and for the same reason never listed.
  "rename-active", "toggle-read-edit", "export-markdown",
];

const field = (page: Page) => page.getByTestId("appbar-searchpage").locator("input");
const command = (page: Page, id: string) => page.getByTestId(`command-${id}`);

/** The palette from the open note: its menu, then "Commands". */
async function paletteFromNote(page: Page) {
  await page.getByTestId("note-menu").click();
  await page.getByTestId("note-commands").click();
  await expect(field(page)).toHaveValue(">");
}

test("the palette lists the twelve, and running one reaches the surface that serves it", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
        path: "vault/Reach.md", data: "# Reach\n\nA sentence only this note carries: palettereach.\n",
        directory: "DATA", encoding: "utf8", recursive: true,
      });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    // --- No note open: the six vault commands are there, the note ones are not.
    await page.getByTestId("appbar-search").first().click();
    await field(page).fill(">");
    for (const id of VAULT_COMMANDS) await expect(command(page, id), `${id} is listed`).toBeVisible();
    for (const id of NOTE_COMMANDS) await expect(command(page, id), `${id} needs an open note`).toHaveCount(0);

    // A command that NAVIGATES: the import wizard is on screen afterwards, and
    // the palette is gone from under it — back leads to where the palette was
    // opened, not to the palette.
    await field(page).fill(">import");
    await command(page, "import-pkm").click();
    await expect(page.locator(".m-appbar-ttl", { hasText: "Import from another app" })).toBeVisible();
    await expect(field(page)).toHaveCount(0);
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page.getByTestId("appbar-search").first()).toBeVisible();

    // A command that RUNS: the rebuild answers with the Maintenance row's own
    // message, because both call one function.
    await page.getByTestId("appbar-search").first().click();
    await field(page).fill(">rebuild");
    await command(page, "rebuild-index").click();
    await expect(page.getByText("Search index rebuilt.")).toBeVisible({ timeout: 20000 });

    // --- Open the note, the way a reader does.
    await page.getByTestId("appbar-search").first().click();
    await field(page).fill("palettereach");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Reach");
    await page.locator("[data-search-occurrence]").first().click();
    await expect(page.locator(".cm-content")).toContainText("palettereach", { timeout: 15000 });

    // --- Over the note: every note command is listed, next to the vault ones.
    await paletteFromNote(page);
    for (const id of [...NOTE_COMMANDS, ...VAULT_COMMANDS]) await expect(command(page, id), `${id} is listed over a note`).toBeVisible();

    // Version history: the note comes back with its context on the history segment.
    await command(page, "version-history").click();
    await expect(page.locator(".cm-content")).toContainText("palettereach");
    await expect(page.locator(".m-sheet .pv-seg-item.is-active")).toHaveText(/History/);
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".m-sheet")).toHaveCount(0);

    // Markdown source: the same switch the note menu flips — its label says so afterwards.
    await paletteFromNote(page);
    await command(page, "toggle-source").click();
    await expect(page.locator(".cm-content")).toContainText("# Reach", { timeout: 15000 });
    await page.getByTestId("note-menu").click();
    await expect(page.getByRole("button", { name: "Live Preview" })).toBeVisible();

    // Rename — one of the three that were built and never listed: the prompt opens.
    await page.getByTestId("note-commands").click();
    await expect(field(page)).toHaveValue(">");
    await command(page, "rename-active").click();
    await expect(page.getByText("New name")).toBeVisible();
  } finally {
    await sql.close();
  }
});
