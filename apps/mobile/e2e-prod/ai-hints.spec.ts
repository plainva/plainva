import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Calm hints at the open note on the phone (plan KI-Harness P8-3, mockup
 * chapter 25): the tab "Hints" of the note's sheet, after "Related" — the
 * desktop section's counterpart, from the same list. What the device notices
 * by itself, without a model: a link that leads nowhere, a TODO line that is
 * no task yet. A tap takes the one step the app already knows; a step that
 * changes the note reaches the note under the sheet. Hidden hints come back in
 * the phone's AI settings.
 *
 * Against the real SQLite index: whether a link leads nowhere is asked of the
 * index by the rule a tap on the link follows.
 */

const PLAN = "# Plan\n\nThe plan for the harbour studio. See [[Kickoff]].\nTODO: call Tom\nTODO send the offer\n";

/** A file of the vault as the app wrote it; null when there is none. */
async function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (path) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const file = await fs.readFile({ path, directory: "DATA" }).catch(() => null);
    if (!file) return null;
    // What the app laid down as bytes is a Blob in the browser build; a text it wrote is its text.
    if (file.data instanceof Blob) return new TextDecoder().decode(new Uint8Array(await file.data.arrayBuffer()));
    return typeof file.data === "string" ? file.data : null;
  }, path);
}

/** Back to a screen with the app's navigation. */
async function backToNavigation(page: Page) {
  for (let i = 0; i < 6 && !(await page.getByTestId("nav-settings").first().isVisible()); i++) {
    const back = page.getByRole("button", { name: /^Back$/ }).first();
    if (await back.isVisible()) await back.click();
    await page.waitForTimeout(300);
  }
}

test("AI hints: the note's sheet names a link that leads nowhere and the TODO lines; a tap takes each one step, and the settings bring a hidden hint back", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is on for this device; no model is set up — the hints need none.
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true }));
    });
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (text) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Plan.md", data: text, directory: "DATA", encoding: "utf8", recursive: true });
    }, PLAN);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // Open the note the way a reader does: through the search.
    const field = page.getByTestId("appbar-searchpage").locator("input");
    const search = page.getByRole("button", { name: /^Search$/ }).first();
    await page.waitForTimeout(1500);
    for (let i = 0; i < 5 && !(await field.isVisible()) && !(await search.isVisible()); i++) {
      const back = page.getByRole("button", { name: /^Back$/ }).first();
      if (await back.isVisible()) await back.click();
      await page.waitForTimeout(400);
    }
    if (!(await field.isVisible())) await search.click();
    await field.fill("harbour studio");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Plan", { timeout: 15_000 });
    await page.locator("[data-search-occurrence]").first().click();

    // 1. The tab after "Related": three hints, each with its line and its one step.
    await page.getByTestId("note-context").click();
    const sheet = page.locator(".m-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await sheet.getByRole("radio", { name: "Hints" }).click();
    const rows = sheet.getByTestId("hints-row");
    await expect(rows).toHaveCount(3, { timeout: 15_000 });
    await expect(rows.nth(0)).toContainText("[[Kickoff]] leads nowhere");
    await expect(rows.nth(0)).toContainText("Line 3");
    await expect(rows.nth(1)).toContainText("“call Tom”");
    await expect(rows.nth(2)).toContainText("“send the offer”");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-hints-tab-mobile.png") });

    // 2. Why, and "Don't show again" for exactly this one.
    await rows.nth(2).getByTestId("hints-why").click();
    const why = rows.nth(2).getByTestId("hints-why-panel");
    await expect(why).toContainText("noticed on this device · no model");
    await why.getByTestId("hints-dismiss").click();
    await expect(rows).toHaveCount(2);

    // 3. "As a task": that line where it stands; the note under the sheet reads it again, and the hint is gone.
    await rows.nth(1).getByTestId("hints-act").click();
    await expect.poll(() => readFile(page, "vault/Plan.md")).toBe("# Plan\n\nThe plan for the harbour studio. See [[Kickoff]].\n- [ ] call Tom\nTODO send the offer\n");
    await expect(rows).toHaveCount(1);

    // 4. Paused for this note, with the buttons under the list — and back.
    await sheet.getByTestId("hints-pause-note").click();
    await expect(sheet.getByTestId("hints-state")).toContainText("Paused for this note.");
    await sheet.getByTestId("hints-resume-note").click();
    await expect(rows).toHaveCount(1);

    // 5. "Create note": where the link finds it, and it opens.
    await rows.nth(0).getByTestId("hints-act").click();
    await expect.poll(() => readFile(page, "vault/Kickoff.md")).not.toBeNull();
    await expect(sheet).toHaveCount(0);

    // 6. The phone's AI settings: the switch, and the hidden hint counted — brought back there.
    await backToNavigation(page);
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-ai").click();
    const show = page.getByTestId("hints-show");
    await show.scrollIntoViewIfNeeded();
    await expect(show).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("settings-ai")).toContainText("1 hint hidden");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-hints-settings-mobile.png") });
    await page.getByTestId("hints-settings-restore").click();
    await expect(page.getByTestId("hints-settings-restore")).toHaveCount(0);
    await show.click();
    await expect(show).toHaveAttribute("aria-checked", "false");
  } finally {
    sql.close();
  }
});
