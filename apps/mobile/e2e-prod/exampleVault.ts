import { expect, type Page } from "@playwright/test";
import type { FilesystemPlugin } from "@capacitor/filesystem";

export type MobileTestGlobals = typeof globalThis & { Capacitor: { Plugins: { Filesystem: FilesystemPlugin } } };

/** Wait for the real first-start directory before test code writes into it. */
export async function waitForVaultDirectory(page: Page) {
  await page.waitForFunction(() => Boolean((globalThis as MobileTestGlobals).Capacitor?.Plugins?.Filesystem));
  // The bridge is available before the first vault directory has been created.
  // Wait for that real startup result so recursive fixture writes cannot race
  // the web filesystem's non-idempotent mkdir with application initialization.
  await expect.poll(() => page.evaluate(async () => {
    try {
      return (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.stat({ path: "vault", directory: "DATA" })).type;
    } catch { return null; }
  }), { timeout: 20_000 }).toBe("directory");
}

/** What the web shell reports when the app goes away (`true`) or comes back. */
async function reportHidden(page: Page, states: boolean[]) {
  await page.evaluate((steps) => {
    for (const hidden of steps) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  }, states);
}

/**
 * Away from the app and back: the web shell reports it as a visibility change,
 * and the app catches up. One copy — two specs each carried their own.
 */
export async function returnToApp(page: Page) {
  await reportHidden(page, [true, false]);
}

/** Away from the app, and not back yet: what has to happen on the way out. */
export async function leaveApp(page: Page) {
  await reportHidden(page, [true]);
}

export const EXAMPLE_NOTE = "---\ntype: Note\n---\n# Example\n\nA sentence to review.\n";

/** The same note as an editor on Windows may leave it: a byte order mark and `\r\n` (the mark is built here, never typed). */
export const EXAMPLE_NOTE_FROM_WINDOWS = String.fromCharCode(0xfeff) + EXAMPLE_NOTE.replace(/\n/g, "\r\n");

/** Explicit test data. Reopening an empty user vault must never seed notes. */
export async function seedExampleNote(page: Page, data: string = EXAMPLE_NOTE) {
  await waitForVaultDirectory(page);
  await page.evaluate(async (text) => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
      path: "vault/Example.md", data: text,
      directory: "DATA", encoding: "utf8", recursive: true,
    });
  }, data);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

/** A vault file exactly as it lies there — line ends and mark included. */
export async function readVaultFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (file) => String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({
    path: "vault/" + file, directory: "DATA", encoding: "utf8",
  })).data), path);
}
