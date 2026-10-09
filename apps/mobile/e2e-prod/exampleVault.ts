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

/** Explicit test data. Reopening an empty user vault must never seed notes. */
export async function seedExampleNote(page: Page) {
  await waitForVaultDirectory(page);
  await page.evaluate(async () => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
      path: "vault/Example.md", data: "---\ntype: Note\n---\n# Example\n\nA sentence to review.\n",
      directory: "DATA", encoding: "utf8", recursive: true,
    });
  });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}
