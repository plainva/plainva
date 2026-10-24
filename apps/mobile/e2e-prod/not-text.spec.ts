import { test, expect, type Page } from "@playwright/test";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A file whose name says text and whose bytes are not UTF-8, on the phone
 * (finding 2026-10-11): a note from an old program and a `.csv` Excel saved,
 * both in Windows-1252. The phone opened such a file wherever its reader
 * replaces what is not UTF-8 — the app's storage on Android, a folder the user
 * picked —, with replacement characters, and the first save wrote that reading
 * over the file. Now it shows what the file is, as for a file the first bytes
 * give away, and offers it to another app. Nothing is written to it.
 *
 * Against the production bundle, with real files in the web shell's storage.
 * The web shell keeps a file laid down as bytes as a Blob and reads it the way
 * Android's reader does (`CapacitorVaultAdapter.readTextFile`), so the file is
 * here what it is on a phone.
 */
const WINDOWS_1252 = (text: string) => [...text].map((char) => char.charCodeAt(0));
const OLD_NOTE = WINDOWS_1252("# Grüße\r\n\r\nAus einem alten Programm.\r\n");
const TABLE = WINDOWS_1252("id;name\r\n1;Grün\r\n2;Blau\r\n");

async function vaultWith(page: Page, files: Record<string, number[]>) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    // Laid down as bytes, the way a sync or another program leaves them.
    for (const [path, bytes] of entries) await fs.writeFile({ path: "vault/" + path, data: new Blob([new Uint8Array(bytes)]), directory: "DATA" as never, recursive: true });
  }, Object.entries(files));
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

/** The bytes that lie there now. */
async function bytesOf(page: Page, path: string): Promise<number[]> {
  return page.evaluate(async (file) => {
    const { data } = await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/" + file, directory: "DATA" as never });
    return data instanceof Blob ? Array.from(new Uint8Array(await data.arrayBuffer())) : Array.from(new TextEncoder().encode(String(data)));
  }, path);
}

test("a note in Windows-1252 shows that it is not text, offers it to another app, and stays as it lies there", async ({ page }) => {
  await vaultWith(page, { "Alt.md": OLD_NOTE, "Data.csv": TABLE });
  await page.getByText("Alt", { exact: true }).first().click();
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This file is not text")).toBeVisible();
  await expect(page.getByTestId("note-not-text-share")).toBeVisible();
  // No editor holds a reading of it, and there is no way into one.
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByTestId("note-edit")).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("not-text-mobile-note.png") });
  expect(await bytesOf(page, "Alt.md")).toEqual(OLD_NOTE);
  await page.getByTestId("note-not-text-back").click();

  // The table the same way.
  await page.getByText("Data.csv", { exact: true }).first().click();
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".cm-content")).toHaveCount(0);
  expect(await bytesOf(page, "Data.csv")).toEqual(TABLE);
});

test("what was typed into a note that another program saves in Windows-1252 meanwhile is kept beside it, as a conflict copy the note points to", async ({ page }) => {
  await vaultWith(page, { "Alt.md": [...new TextEncoder().encode("# Alt\n\neins\n")] });
  await page.getByText("Alt", { exact: true }).first().click();
  await page.getByTestId("note-edit").click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText("eins");
  // Another program saves the note in its own encoding while it is open.
  await page.evaluate(async (bytes) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Alt.md", data: new Blob([new Uint8Array(bytes)]), directory: "DATA" as never, recursive: true });
  }, OLD_NOTE);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("zwei");
  // The save cannot go into the note: the text goes beside it, and the screen
  // shows the note as what it is now, with the card that leads to the text.
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This note was changed elsewhere")).toBeVisible();
  const copies = await page.evaluate(async () => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "vault", directory: "DATA" as never })).files
    .map((file) => file.name).filter((name) => name.startsWith("Alt.CONFLICT-")));
  expect(copies).toHaveLength(1);
  await expect(page.locator("code", { hasText: copies[0] })).toBeVisible();
  const kept = await page.evaluate(async (name) => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/" + name, directory: "DATA" as never, encoding: "utf8" as never })).data, copies[0]);
  expect(kept).toContain("eins");
  expect(kept).toContain("zwei");
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("not-text-mobile-kept.png") });
  expect(await bytesOf(page, "Alt.md")).toEqual(OLD_NOTE);
});

test("a pull that turns an open note into Windows-1252 and leaves this phone's version beside it shows the card at once, as on the desktop", async ({ page }) => {
  await vaultWith(page, { "Alt.md": [...new TextEncoder().encode("# Alt\n\neins\n")] });
  await page.getByText("Alt", { exact: true }).first().click();
  await page.getByTestId("note-edit").click();
  await expect(page.locator('.cm-content[contenteditable="true"]').first()).toContainText("eins");
  // What a pull does: the other device's version in the note's place, this
  // phone's own as a conflict copy beside it — and the news of the change.
  const COPY = "Alt.CONFLICT-2026-10-20T08-00-00-000Z.md";
  await page.evaluate(async ({ bytes, copy }) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    await fs.writeFile({ path: "vault/Alt.md", data: new Blob([new Uint8Array(bytes)]), directory: "DATA" as never, recursive: true });
    await fs.writeFile({ path: "vault/" + copy, data: new Blob([new TextEncoder().encode("# Alt\n\neins\n")]), directory: "DATA" as never, recursive: true });
    window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path: "Alt.md" } }));
  }, { bytes: OLD_NOTE, copy: COPY });
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This note was changed elsewhere")).toBeVisible();
  await expect(page.locator("code", { hasText: COPY })).toBeVisible();
  expect(await bytesOf(page, "Alt.md")).toEqual(OLD_NOTE);
});

test("the copy a sync left beside such a table is shown from it, as on the desktop, and takes its place byte for byte from the comparison", async ({ page }) => {
  const COPY = "Data.CONFLICT-2026-10-11T08-00-00-000Z.csv";
  const COPY_BYTES = WINDOWS_1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Weiß\r\n");
  await vaultWith(page, { "Data.csv": TABLE, [COPY]: COPY_BYTES });
  await page.getByText("Data.csv", { exact: true }).first().click();
  await expect(page.getByTestId("note-not-text")).toBeVisible({ timeout: 20_000 });
  // No editor of this phone kept it: the card leads to it all the same.
  await expect(page.getByText("This note was changed elsewhere")).toBeVisible();
  await expect(page.locator("code", { hasText: COPY })).toBeVisible();
  await page.getByRole("button", { name: "Show differences" }).click();
  // Nothing of either file is shown — and the copy can take the table's place.
  await expect(page.getByTestId("compare-not-text")).toBeVisible();
  await page.getByTestId("compare-adopt").click();
  await page.getByRole("button", { name: "Replace file and delete conflict copy" }).click();
  await expect.poll(() => bytesOf(page, "Data.csv"), { timeout: 10_000 }).toEqual(COPY_BYTES);
  await expect(page.getByText("This note was changed elsewhere")).toHaveCount(0);
});
