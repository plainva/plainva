import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

// The phone's editor reads a note as the desktop's does (bug-clearing plan, P9;
// the editor is shared, `apps/desktop/e2e/editorNoteParts.spec.ts`):
// `![a](Zoom%20one.svg)` shows the picture in the editor (open-items plan 3.42),
// a fence in a value of the properties block leaves the text behind it
// Markdown (3.46), and `[[Target\|alias]]` names "Target" (3.133 no. 1).

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="cornflowerblue"/></svg>';
const PARTS = [
  "---",
  "snippet: |",
  "  ```",
  "  code",
  "---",
  "# Parts heading",
  "",
  "Some **bold** words and #parttag here.",
  "",
  "Moved out of a table: [[Target\\|the target]].",
  "",
  "![Zoom](Zoom%20one.svg)",
  "",
  "The end.",
  "",
].join("\n");

test("the editor shows the picture, formats the text behind a fence in the properties, and links to the note a cell names", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    await page.evaluate(async ({ parts, svg }) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Parts.md", data: parts, directory: "DATA", encoding: "utf8", recursive: true });
      await fs.writeFile({ path: "vault/Target.md", data: "# Target\n", directory: "DATA", encoding: "utf8", recursive: true });
      await fs.writeFile({ path: "vault/Zoom one.svg", data: btoa(svg), directory: "DATA", recursive: true });
    }, { parts: PARTS, svg: SVG });
    await page.reload();
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Parts", { exact: true }) }).first().click();
    await page.getByTestId("note-edit").click();
    const content = page.locator(".cm-content");
    await expect(content.getByText("The end.")).toBeVisible();

    await expect(content.locator(".pv-tag-pill", { hasText: "parttag" })).toBeVisible();
    const bold = content.getByText("bold", { exact: true });
    await expect.poll(() => bold.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);

    const picture = content.locator('img[alt="Zoom one.svg"]');
    await picture.scrollIntoViewIfNeeded();
    await expect(picture).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => picture.evaluate((el) => (el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0)).toBe(160);

    await expect(content.locator('[data-link-target="Target"]')).toHaveText("the target");
    await expect(content.locator(".cm-wiki-link--unresolved")).toHaveCount(0);

    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("editor-note-parts-mobile.png") });
  } finally { sql.close(); }
});
