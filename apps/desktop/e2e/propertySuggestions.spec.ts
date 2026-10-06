import { expect, test, type Page } from "@playwright/test";
import type { PropertyProbeWindow } from "./fixtures/propertyProbe";

test.use({ hasTouch: true });
async function open(page: Page) {
  await page.route("**/__property_probe", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}#host{padding:16px;max-width:600px}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/propertyProbe.tsx');</script></body></html>` }));
  page.on("pageerror", error => console.log("Property probe:", error.message));
  await page.goto("/__property_probe");
  await page.waitForFunction(() => !!(window as PropertyProbeWindow).propertyProbe);
}

for (const shell of ["desktop", "mobile"] as const) {
  test(`${shell}: known names use the governing type and curated values exclusively`, async ({ page }) => {
    await page.setViewportSize({ width: shell === "mobile" ? 390 : 900, height: 812 }); await open(page);
    await page.evaluate(shell => (window as PropertyProbeWindow).propertyProbe.mount({ shell, mode: "name" }), shell);
    const input = page.getByRole("combobox").first(); await input.fill("Statu");
    await expect(page.getByRole("listbox").getByRole("option", { name: /Status/ })).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option", { name: /Status/ })).toContainText("8");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath(`property-names-${shell}.png`) });
    if (shell === "desktop") { await input.press("ArrowDown"); await input.press("Enter"); }
    else { await page.getByRole("listbox").getByRole("option", { name: /Status/ }).tap(); await page.getByRole("button", { name: "OK", exact: true }).click(); }
    await expect(page.getByTestId("property-type")).toHaveText("status");
    if (shell === "desktop") await page.locator(".pv-select > button").click();
    await expect(page.getByRole("button", { name: "Curated", exact: true })).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ animations: "disabled", path: test.info().outputPath(`properties-${shell}.png`) });
    await page.getByRole("button", { name: "Curated", exact: true }).click();
    await expect(page.getByTestId("property-value")).toHaveText('"Curated"');
    expect(await page.evaluate(() => (window as PropertyProbeWindow).propertyProbe.requests)).toHaveLength(0);
  });
  test(`${shell}: list elements can expand to another folder and free text keeps its type`, async ({ page }) => {
    await open(page); await page.evaluate(shell => (window as PropertyProbeWindow).propertyProbe.mount({ shell, mode: "value", type: "list" }), shell);
    if (shell === "desktop") await page.locator(".pv-chip-input").focus();
    await expect(page.getByRole("button", { name: /^Local(?:\s+\d+)?$/ })).toBeVisible();
    await page.getByRole("button", { name: /Search the entire vault|Im ganzen Vault suchen/ }).click();
    await page.getByRole("button", { name: /^Other folder(?:\s+\d+)?$/ }).click();
    if (shell === "mobile") await page.locator(".m-cell-commit").click();
    await expect(page.getByTestId("property-value")).toHaveText('["Other folder"]');
    await expect(page.getByTestId("property-type")).toHaveText("list");
    await page.evaluate(shell => (window as PropertyProbeWindow).propertyProbe.mount({ shell, mode: "value", type: "text" }), shell);
    const field = page.locator(shell === "desktop" ? ".pv-property-text input" : ".m-sheet-inputrow textarea");
    await field.fill("A freely written sentence");
    if (shell === "desktop") await field.press("Enter"); else await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.getByTestId("property-value")).toHaveText('"A freely written sentence"');
    await expect(page.getByTestId("property-type")).toHaveText("text");
  });
  test(`${shell}: delayed old-note results and empty curated vocabularies never leak`, async ({ page }) => {
    await open(page); await page.evaluate(shell => (window as PropertyProbeWindow).propertyProbe.mount({ shell, mode: "value", path: "Old/a.md" }), shell);
    if (shell === "desktop") await page.locator(".pv-property-text input").focus();
    await expect.poll(() => page.evaluate(() => (window as PropertyProbeWindow).propertyProbe.requests.length)).toBeGreaterThan(0);
    await page.getByTestId("change-note").dispatchEvent("click");
    if (shell === "desktop") await page.locator(".pv-property-text input").focus();
    await expect(page.getByRole("button", { name: "Fresh", exact: true })).toBeVisible();
    await page.evaluate(() => (window as PropertyProbeWindow).propertyProbe.flush());
    await expect(page.getByRole("button", { name: "Stale", exact: true })).toHaveCount(0);
    await page.evaluate(shell => (window as PropertyProbeWindow).propertyProbe.mount({ shell, mode: "value", type: "select", curated: [] }), shell);
    if (shell === "desktop") await page.locator(".pv-select > button").click();
    expect(await page.evaluate(() => (window as PropertyProbeWindow).propertyProbe.requests)).toHaveLength(0);
    await expect(page.getByRole("button", { name: /^Local(?:\s+\d+)?$/ })).toHaveCount(0);
  });
}
