import { test, expect, type Page } from "@playwright/test";
import type { RtlProbeWindow } from "./fixtures/rtlProbe";

/**
 * Right-to-left text in the editor (issue 111, plan Issues und Diskussionen
 * 2026-09-30, Teil R, § 6). Runs in the WebKit editor regression job (the
 * engine of macOS, iOS and the Linux shell) and in the Chromium suite (the
 * engine of WebView2 and Android). The unit tests prove each line is GIVEN
 * its direction; this proves the engine acts on it: the line runs from the
 * right, the arrow keys move the way the text reads, a selection grows from
 * the right edge, and a task's box stands on the right of its text.
 */
async function loadProbe(page: Page) {
  await page.route("**/__rtl_editor", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}#host{height:760px;width:100%;}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/rtlProbe.ts');</script></body></html>` }));
  await page.goto("/__rtl_editor");
  await page.waitForFunction(() => !!(window as RtlProbeWindow).rtlProbe);
}
const selection = (page: Page) => page.evaluate(() => (window as RtlProbeWindow).rtlProbe.selection());

for (const live of [true, false]) {
  test(`${live ? "live" : "source"}: an Arabic line runs from the right, a Latin one from the left`, async ({ page }) => {
    await loadProbe(page);
    await page.evaluate((l) => (window as RtlProbeWindow).rtlProbe.mount(l), live);
    const arabic = await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.line(1));
    expect(arabic.dir).toBe("rtl");
    expect(arabic.direction).toBe("rtl");
    // The first character stands to the RIGHT of the last one.
    expect(arabic.firstLeft!).toBeGreaterThan(arabic.lastLeft!);
    const latin = await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.line(5));
    expect(latin.dir).toBeNull();
    expect(latin.direction).toBe("ltr");
    expect(latin.firstLeft!).toBeLessThan(latin.lastLeft!);
    // A finished task keeps its line right to left.
    expect((await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.line(3))).dir).toBe("rtl");
  });
}

test("the arrow keys move the way an Arabic line reads", async ({ page }) => {
  await loadProbe(page);
  await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.mount(true));
  const start = await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.focusAt(1, 0));
  // Left goes FORWARD in a right-to-left line.
  await page.keyboard.press("ArrowLeft");
  expect((await selection(page)).head).toBe(start + 1);
  await page.keyboard.press("ArrowLeft");
  expect((await selection(page)).head).toBe(start + 2);
  await page.keyboard.press("ArrowRight");
  expect((await selection(page)).head).toBe(start + 1);
});

test("a selection in an Arabic line grows from its right edge", async ({ page }) => {
  await loadProbe(page);
  await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.mount(true));
  const start = await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.focusAt(1, 0));
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
  expect(await selection(page)).toEqual({ anchor: start, head: start + 3 });
  // It covers the first three characters, which sit on the RIGHT end of the line.
  // The layer is drawn in CodeMirror's next measure cycle, hence the poll.
  await expect.poll(async () => (await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.selectionEdgeGaps(1))) ?? Infinity).toBeLessThanOrEqual(2);
});

test("a finished Arabic task shows its box on the right of its text", async ({ page }) => {
  await loadProbe(page);
  await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.mount(true));
  const geo = await page.evaluate(() => (window as RtlProbeWindow).rtlProbe.taskGeometry());
  expect(geo.box).not.toBeNull();
  expect(geo.box!.left).toBeGreaterThanOrEqual(geo.textRight! - 1);
});
