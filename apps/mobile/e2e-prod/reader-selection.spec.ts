import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

const tail = Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1}: Der vollständige Text bleibt auch außerhalb des sichtbaren Ausschnitts kopierbar.`).join("\n\n");
const source = "---\ntype: Note\ntitle: Auswahl\n---\n# Auswahl\n\nEinleitung 😀 mit **Zielwort** und einem Ende.\n\nZielwort in einem anderen Absatz bleibt erhalten.\n\n" + tail + "\n";
const visibleText = "Auswahl\n\nEinleitung 😀 mit Zielwort und einem Ende.\n\nZielwort in einem anderen Absatz bleibt erhalten.\n\n" + tail;

for (const language of ["en", "de"]) test(`reader clipboard actions copy a long note and preserve source offsets at 320px (${language})`, async ({ page, context }) => {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.setViewportSize({ width: 320, height: 740 });
  const sql = await installSqlBridge(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(language => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language, motion: "off" })), language);
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async data => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Auswahl.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, source);
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible();
    // The overlay handler dismisses What's New before the row action.
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Auswahl", { exact: true }) }).first().click();
    const editor = page.locator(".m-editor .cm-content");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    const line = page.locator(".cm-line").filter({ hasText: "Einleitung 😀" });
    const point = await line.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, from = node.textContent?.indexOf("Zielwort") ?? -1;
        if (from < 0) continue;
        const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + 8);
        const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      throw new Error("reader did not render the target word");
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId("read-selection-edit")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Zielwort");
    expect(await editor.evaluate(el => !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(true);
    const toolbar = page.getByTestId("read-selection-bar");
    expect(await toolbar.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight
        && el.scrollWidth <= el.clientWidth
        && [...el.querySelectorAll("button")].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.x >= box.x && rect.right <= box.right && button.scrollHeight <= button.clientHeight;
        });
    })).toBe(true);
    // The selection remains anchored while its real editor scroller moves.
    const initialTop = (await toolbar.boundingBox())!.y;
    const scroller = page.locator(".m-editor .cm-scroller");
    await scroller.evaluate(el => { el.scrollTop = 24; });
    await expect.poll(async () => Math.round((await toolbar.boundingBox())!.y)).toBe(Math.round(initialTop - 24));
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Zielwort");
    // Model an offset visual viewport; this is browser geometry, not a native
    // keyboard or pinch-zoom claim. Every verb must still be reachable.
    await page.evaluate(() => {
      const original = window.visualViewport;
      (window as Window & { restoreViewport?: () => void }).restoreViewport = () => Object.defineProperty(window, "visualViewport", { configurable: true, value: original });
      Object.defineProperty(window, "visualViewport", { configurable: true,
        value: Object.assign(new EventTarget(), { offsetLeft: 25, offsetTop: 35, width: 250, height: 480 }) });
      window.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => toolbar.evaluate(el => {
      const box = el.getBoundingClientRect(), viewport = window.visualViewport!;
      return box.left >= viewport.offsetLeft + 8 && box.right <= viewport.offsetLeft + viewport.width - 8
        && box.top >= viewport.offsetTop + 8 && box.bottom <= viewport.offsetTop + viewport.height - 8;
    })).toBe(true);
    await expect(toolbar).toHaveAttribute("data-compact", "");
    await page.evaluate(() => { (window as Window & { restoreViewport?: () => void }).restoreViewport?.(); window.dispatchEvent(new Event("resize")); });
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await expect.poll(async () => Math.round((await toolbar.boundingBox())!.y)).toBe(Math.round(initialTop));
    await page.getByTestId("read-selection-copy").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Zielwort");
    // The document exceeds CodeMirror's mounted viewport. The toolbar must
    // select the whole source, including paragraphs that have no DOM node.
    await expect(page.locator(".cm-line").filter({ hasText: "Absatz 60:" })).toHaveCount(0);
    await page.getByTestId("read-selection-all").click();
    await page.getByTestId("read-selection-copy").click();
    // Reader copy follows the rendered text; hidden YAML/format markers are
    // preserved in the source file and are not injected into the clipboard.
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n").trim())).toBe(visibleText);
    // Select the same word through the rendered reader again, then use its own
    // Edit action. Replacing it proves the source offsets, including emoji and
    // hidden Markdown marks, rather than merely checking a toolbar exists.
    await page.keyboard.press("Control+Home");
    await page.mouse.dblclick(point.x, point.y);
    await page.getByTestId("read-selection-edit").click();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    // Type immediately when editing becomes available. A delayed navigation
    // event must never reselect the old offsets after the first keystroke.
    await page.keyboard.type("Ersetzt");
    await expect.poll(async () => page.evaluate(async () => {
      const result = await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/Auswahl.md", directory: "DATA", encoding: "utf8" });
      return result.data;
    })).toBe(source.replace("Zielwort", "Ersetzt"));
  } finally { sql.close(); }
});
