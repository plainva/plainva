import { expect, type Page } from "@playwright/test";
import type { FilesystemPlugin } from "@capacitor/filesystem";

export type MobileTestGlobals = typeof globalThis & { Capacitor: { Plugins: { Filesystem: FilesystemPlugin } } };

/** Explicit test data. Reopening an empty user vault must never seed notes. */
export async function seedExampleNote(page: Page) {
  await page.waitForFunction(() => Boolean((globalThis as MobileTestGlobals).Capacitor?.Plugins?.Filesystem));
  await page.evaluate(async () => {
    await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({
      path: "vault/Example.md", data: "---\ntype: Note\n---\n# Example\n\nA sentence to review.\n",
      directory: "DATA", encoding: "utf8", recursive: true,
    });
  });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}
