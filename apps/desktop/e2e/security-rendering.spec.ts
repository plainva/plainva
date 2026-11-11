import { test, expect } from "./fixtures/clockedTest";
import type { SecurityRenderingWindow } from "./fixtures/securityRenderingProbe";

test("gallery covers and converted HTML remain inert in the real reader", async ({ page }) => {
  await page.route("https://example.invalid/**", route => route.abort());
  await page.route("**/__security_rendering", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/securityRenderingProbe.tsx'); window.securityRenderingProbe.render();</script></body></html>` }));
  await page.goto("/__security_rendering");
  await expect(page.getByTestId("base-row")).toHaveCount(6);
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
  await expect(page.locator('img[src^="data:image/"]')).toHaveCount(1);
  await expect(page.locator('img[src^="javascript:"],img[src^="data:text/html"],[onerror],#converted img,#comment img')).toHaveCount(0);
  await expect(page.locator("#converted")).toContainText('<img src=x onerror="window.securityExecuted=true">');
  await expect(page.locator("#comment")).toContainText("Visible");
  await expect.poll(() => page.locator('img[src^="blob:"],img[src^="data:image/"]').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(await page.evaluate(() => (window as SecurityRenderingWindow).securityExecuted)).toBeUndefined();
  const blob = await page.locator('img[src^="blob:"]').getAttribute("src");
  await page.evaluate(() => (window as SecurityRenderingWindow).securityRenderingProbe.render(false));
  await expect.poll(() => page.evaluate(() => (window as SecurityRenderingWindow).securityRenderingProbe.revoked)).toContain(blob);
});
