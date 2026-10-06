import { test, expect, type Page } from "@playwright/test";
import { openProbePage } from "./fixtures/openProbePage";
import type { ListProbeWindow } from "./fixtures/listProbe";

async function loadProbe(page: Page) {
  await page.route("**/__list_geometry", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}#host{height:760px;width:100%;}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/listProbe.ts');</script></body></html>` }));
  await openProbePage(page, "/__list_geometry", () => !!(window as ListProbeWindow).listProbe);
}
async function quiet(page: Page) {
  // Compare idle windows after layout, rather than using total startup updates.
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => (window as ListProbeWindow).listProbe.snapshot());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => (window as ListProbeWindow).listProbe.snapshot());
  expect(after.updates - before.updates).toBeLessThanOrEqual(2);
  return after;
}

for (const shell of ["mobile", "desktop"] as const) for (const live of [true, false]) for (const indent of ["  ", "\t"]) for (const width of [375, 390]) {
  test(`${shell} ${live ? "live" : "source"} ${indent === "\t" ? "tabs" : "spaces"} ${width}: stable prefixes through font, fold, resize and editing`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 812 }); await loadProbe(page);
    for (const font of ["default", "Georgia"]) {
      const size = font === "default" ? 16 : 18;
      const doc = await page.evaluate(options => (window as ListProbeWindow).listProbe.mount(options), { shell, live, indent, font, size });
      expect((await quiet(page)).text).toBe(doc);
      expect((await quiet(page)).size).toBe(`${size}px`);
      if (live || indent !== "\t") {
        const alignments = await page.evaluate(() => (window as ListProbeWindow).listProbe.alignments());
        expect(alignments.length).toBeGreaterThanOrEqual(3);
        for (const alignment of alignments) expect(Math.abs(alignment.first - alignment.wrapped), JSON.stringify(alignment)).toBeLessThanOrEqual(1.5);
      }
      await page.evaluate(() => (window as ListProbeWindow).listProbe.fold()); await quiet(page);
      await page.evaluate(() => (window as ListProbeWindow).listProbe.fold());
      await page.setViewportSize({ width: width === 375 ? 390 : 375, height: 760 });
      await page.evaluate(() => { (window as ListProbeWindow).listProbe.geometry(); (window as ListProbeWindow).listProbe.font(20); });
      await quiet(page);
      await page.evaluate(() => (window as ListProbeWindow).listProbe.edit());
      const edited = await quiet(page);
      expect(edited.text).toBe(doc + "Further input"); expect(edited.cursor).toBe(edited.text.length);
    }
    expect(errors).toEqual([]);
  });
}

for (const shell of ["mobile", "desktop"] as const) test(`${shell}: a fold control waits for release and ignores dragging and right clicks`, async ({ page }) => {
  await loadProbe(page);
  await page.evaluate(shell => (window as ListProbeWindow).listProbe.mount({ shell, live: true, indent: "  ", size: 16, font: "default" }), shell);
  const bullet = page.locator(".cm-md-bullet--foldable").first();
  const rect = await bullet.boundingBox(); expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await expect(bullet).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(x + 50, y, { steps: 5 }); await page.mouse.up();
  await expect(bullet).toHaveAttribute("aria-expanded", "true");
  await bullet.click({ button: "right" }); await expect(bullet).toHaveAttribute("aria-expanded", "true");
  await bullet.click(); await expect(bullet).toHaveAttribute("aria-expanded", "false");
});
