import { test, expect, type BrowserContext } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Writing with the keyboard up tucks the note's bar away (F8), and the text
 * must still start below the strip the system draws over the top of the
 * screen (TestFlight 2026-11-03, iPhone: the first line ran under the clock
 * and the Dynamic Island, because the tucked bar took the inset with it).
 *
 * A browser has neither a notch nor a soft keyboard. The notch is the app's
 * one token for it (`--m-safe-top`, as in safe-top.spec.ts); the keyboard is
 * a stand-in for the native Keyboard plugin, announced the way Capacitor
 * announces a native plugin (a plugin header), whose events the test sends.
 */
const NOTCH = 59;

type KeyboardSeam = { listeners: Record<string, ((data: unknown) => void)[]> };
type SeamGlobals = typeof globalThis & { __keyboard: KeyboardSeam };

async function standInKeyboard(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    const seam: KeyboardSeam = { listeners: {} };
    (globalThis as SeamGlobals).__keyboard = seam;
    let next = 0;
    (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: [{ name: "Keyboard", methods: [{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "callback" }] }],
      nativeCallback(_plugin: string, method: string, options: { eventName: string }, callback: (data: unknown) => void) {
        if (method === "addListener") (seam.listeners[options.eventName] ??= []).push(callback);
        return String(next++);
      },
      async nativePromise() {
        return {};
      },
    };
  });
}

test("writing with the keyboard up: the bar steps aside, the first line stays below the status strip", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const sql = await installSqlBridge(context);
  await standInKeyboard(context);
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      const text = "First line of the letter\n\n" + Array.from({ length: 30 }, (_, i) => `Paragraph ${i} of the note.`).join("\n\n");
      await fs.writeFile({ path: "vault/Letter.md", data: text, directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.addStyleTag({ content: `:root { --m-safe-top: ${NOTCH}px !important; }` });

    await page.locator(".m-swipe-front").filter({ has: page.getByText("Letter", { exact: true }) }).first().click();
    await page.getByTestId("note-edit").click();
    const content = page.locator(".cm-content");
    await expect(content).toHaveAttribute("contenteditable", "true");
    await page.locator(".cm-line", { hasText: "Paragraph 3 of" }).click();
    await expect(content).toBeFocused();

    // The keyboard comes up: the shell has registered for it by now.
    await expect.poll(() => page.evaluate(() => (globalThis as SeamGlobals).__keyboard.listeners.keyboardWillShow?.length ?? 0)).toBeGreaterThan(0);
    await page.evaluate(() => (globalThis as SeamGlobals).__keyboard.listeners.keyboardWillShow.forEach((cb) => cb({ keyboardHeight: 300 })));

    const chrome = page.locator(".m-note-chrome");
    await expect(chrome).toHaveClass(/is-tucked/);
    // The bar's content is gone; what stays is the strip the system covers.
    await expect(chrome.locator(".m-appbar")).toBeHidden();
    const strip = (await chrome.boundingBox())!;
    expect(strip.y).toBe(0);
    expect(Math.round(strip.height)).toBe(NOTCH);
    // The first line of the text begins at or below it.
    const first = (await page.locator(".cm-line").first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(NOTCH);
    // And nothing of the text is painted inside the strip: the top-most thing there is the spacer.
    const atStrip = await page.evaluate((y) => document.elementFromPoint(187, y)?.closest(".m-note-chrome") !== null, Math.floor(NOTCH / 2));
    expect(atStrip).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("note-tucked-under-notch.png") });

    // The keyboard goes: the bar comes back, and it carries the inset itself again.
    await page.evaluate(() => (globalThis as SeamGlobals).__keyboard.listeners.keyboardWillHide?.forEach((cb) => cb({})));
    await expect(chrome).not.toHaveClass(/is-tucked/);
    await expect(chrome.locator(".m-appbar")).toBeVisible();
    const bar = (await chrome.locator(".m-appbar").boundingBox())!;
    expect(bar.height).toBeGreaterThan(NOTCH);
  } finally {
    await sql.close();
  }
});
