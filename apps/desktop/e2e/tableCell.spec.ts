import { test, expect, type Locator, type Page } from "@playwright/test";
import { openProbePage } from "./fixtures/openProbePage";
import type { TableCellProbeWindow } from "./fixtures/tableCellProbe";

/**
 * A cell of a Markdown table is edited in a field of its own (issue #118,
 * Linux and Android). The field opens with its text selected; a click or a
 * tap inside it afterwards must place the caret there, and a drag must
 * select part of it. The cell's own press handler kept every later press
 * from reaching the field, so the whole text stayed selected and only the
 * arrow keys could move the caret. Runs in the WebKit editor regression job
 * (the engine of the Linux shell, with touch) and in the Chromium suite
 * (the engine of Android and WebView2).
 */
async function loadProbe(page: Page) {
  await page.route("**/__table_cell", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}#host{height:760px;width:100%;}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/tableCellProbe.ts');</script></body></html>` }));
  await openProbePage(page, "/__table_cell", () => !!(window as unknown as TableCellProbeWindow).tableCellProbe);
  await page.evaluate(() => (window as unknown as TableCellProbeWindow).tableCellProbe.mount());
}

const selectionOf = (field: Locator) => field.evaluate((el: HTMLTextAreaElement) => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }));

async function openLongCell(page: Page): Promise<Locator> {
  const cell = page.locator(".cm-md-table tbody tr").first().locator("td").nth(1);
  await cell.click();
  const field = cell.locator("textarea.cm-md-table-input");
  await expect(field).toBeFocused();
  // It opens with the whole text selected, as a database cell does.
  const opened = await selectionOf(field);
  expect(opened).toEqual({ start: 0, end: opened.length, length: opened.length });
  return field;
}

test("a click inside an open cell places the caret where it lands", async ({ page }) => {
  await loadProbe(page);
  const field = await openLongCell(page);
  const box = (await field.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  const after = await selectionOf(field);
  expect(after.start).toBe(after.end);
  expect(after.start).toBeGreaterThan(0);
  expect(after.start).toBeLessThan(after.length);
  await expect(field).toBeFocused();
  // Typing goes in at that place and replaces nothing.
  await page.keyboard.type("X");
  const value = await field.inputValue();
  expect(value.length).toBe(after.length + 1);
  expect(value.indexOf("X")).toBe(after.start);
});

test("a drag inside an open cell selects part of its text", async ({ page }) => {
  await loadProbe(page);
  const field = await openLongCell(page);
  const box = (await field.boundingBox())!;
  const y = box.y + Math.min(box.height / 2, 10);
  // A press on the selected text would pick it up to move it, as in any
  // field — so first a click, which puts the caret down, then the drag.
  await page.mouse.click(box.x + box.width - 6, y);
  expect((await selectionOf(field)).end - (await selectionOf(field)).start).toBe(0);
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 3, y, { steps: 5 });
  await page.mouse.up();
  const after = await selectionOf(field);
  expect(after.end).toBeGreaterThan(after.start);
  expect(after.end - after.start).toBeLessThan(after.length);
});

test("a tap inside an open cell places the caret (touch)", async ({ page }) => {
  test.skip(!test.info().project.use.hasTouch, "needs a touch screen (the WebKit job has one)");
  await loadProbe(page);
  const field = await openLongCell(page);
  const box = (await field.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  const after = await selectionOf(field);
  expect(after.end - after.start).toBeLessThan(after.length);
  await expect(field).toBeFocused();
});
