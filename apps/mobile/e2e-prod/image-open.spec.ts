import { test, expect } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("open a reader and live image, keep native context actions, pinch, pan and reset", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [["Image note.md", "# Image note\n\n![[Zoom.svg|300]]\n\nAfter image.\n"], ["Zoom.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="cornflowerblue"/><circle cx="800" cy="600" r="200" fill="white"/></svg>']]) await fs.writeFile({ path: "vault/" + path, data: path.endsWith(".svg") ? btoa(data) : data, directory: "DATA", ...(path.endsWith(".md") ? { encoding: "utf8" as const } : {}), recursive: true });
    });
    await page.reload(); await page.locator(".m-swipe-front").filter({ has: page.getByText("Image note", { exact: true }) }).first().click();
    const embed = page.locator(".pv-image-embed img"); await expect(embed).toBeVisible();
    await expect(embed).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => embed.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await embed.evaluate(el => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(true);
    await page.getByRole("button", { name: "Open image", exact: true }).click();
    const stage = page.getByTestId("image-zoom-stage"); await expect(stage).toHaveAttribute("data-zoom", "1");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click(); await expect(stage).toHaveAttribute("data-zoom", "1.5");
    await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
    const bounds = await stage.boundingBox(); const x = bounds!.x + bounds!.width / 2, y = bounds!.y + bounds!.height / 2;
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }]);
    await touch("touchMove", [{ x: x - 90, y, id: 1 }, { x: x + 90, y, id: 2 }]); await touch("touchEnd", []);
    await expect.poll(() => stage.getAttribute("data-zoom").then(Number)).toBeCloseTo(3, 1);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("image-zoom-mobile.png") });
    await touch("touchStart", [{ x, y, id: 1 }]); await touch("touchMove", [{ x: x + 60, y: y + 30, id: 1 }]); await touch("touchEnd", []);
    await expect.poll(() => stage.locator("img").evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeGreaterThan(40);
    await page.getByRole("button", { name: "Reset zoom", exact: true }).click(); await expect(stage).toHaveAttribute("data-zoom", "1");
    await stage.tap(); await stage.tap(); await expect(stage).toHaveAttribute("data-zoom", "2.5");
    await stage.focus(); await page.keyboard.press("0"); await expect(stage).toHaveAttribute("data-zoom", "1");
    await page.getByRole("button", { name: /^Back$/ }).click(); await expect(embed).toBeVisible();
    await page.getByTestId("note-edit").click();
    await page.locator(".cm-line").filter({ hasText: "After image." }).click();
    await page.getByRole("button", { name: "Open image", exact: true }).click(); await expect(stage).toHaveAttribute("data-zoom", "1");
    await page.getByRole("button", { name: /^Back$/ }).click(); await expect(embed).toBeVisible();
  } finally { sql.close(); }
});
