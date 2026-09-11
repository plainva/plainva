import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import type { MobileTestGlobals } from "./exampleVault";

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (path) => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({
    path: `vault/${path}`, directory: "DATA", encoding: "utf8",
  })).data as string, path);
}

async function dismissHighlights(page: Page) {
  const close = page.getByTestId("whats-new-close");
  if (await close.isVisible()) await close.click();
}

async function createTour(page: Page, context: BrowserContext) {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ language: "en", motion: "off" }));
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Start locally/ }).click();
  await page.getByRole("button", { name: "Plainva Tour", exact: true }).click();
  await expect.poll(() => readFile(page, "Welcome.md").catch(() => "")).toContain("Tour data version: 2026-09-11");
  await expect.poll(() => readFile(page, "Tour/10 Sharing and automation.md").catch(() => "")).toContain("experimental");
  await dismissHighlights(page);
  return sql;
}

test("a new tour works on a phone and reopening keeps the user's files", async ({ page, context }) => {
  test.setTimeout(60_000);
  const sql = await createTour(page, context);
  try {
    await page.locator(".m-swipe-front").filter({ hasText: /^Projects$/ }).first().click();
    await expect(page.getByTestId("base-summary")).toBeVisible();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByRole("button", { name: /^Properties / }).click();
    const summary = page.getByRole("button", { name: "Summary for Name", exact: true });
    const name = page.locator(".m-cfg-property").first().locator(".m-row");
    expect(await name.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(20);
    expect(await summary.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(100);
    await summary.click();
    await page.getByRole("option", { name: "Filled", exact: true }).click();
    await expect(page.getByTestId("base-summary").locator("td").first()).toHaveText("Filled 5");
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Back", exact: true }).click();

    // Open the generated database, not a handcrafted replacement for it.
    await page.locator(".m-swipe-front").filter({ hasText: /^Quick Notes$/ }).first().click();
    await expect(page.locator(".m-pin-card")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "Configure", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByRole("button", { name: /^Filter / }).click();
    await page.getByRole("button", { name: "+ Header color", exact: true }).click();
    const rule = page.locator(".m-filterrule").first();
    await rule.getByRole("button", { name: "is", exact: true }).click();
    await rule.getByRole("button", { name: "Value..." }).click();
    await page.getByRole("option", { name: "#8a6d3b", exact: true }).click();
    await expect.poll(() => readFile(page, "Quick Notes.base")).toContain('note.plainva.header_color == "#8a6d3b"');
    await expect(page.locator(".m-pin-card")).toHaveCount(1);

    // A deliberately empty combination must keep the full source's choices.
    await page.getByRole("button", { name: "+ Tags · whole note", exact: true }).click();
    const tags = page.locator(".m-filterrule").nth(1);
    await tags.getByRole("button", { name: "contains", exact: true }).click();
    await tags.getByRole("button", { name: "Value..." }).click();
    await expect(page.getByRole("option", { name: "#tour/ideas", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "#tour/ideas", exact: true }).click();
    await expect(page.locator(".m-pin-card")).toHaveCount(0);
    await rule.getByRole("button", { name: "Value..." }).click();
    await expect(page.getByRole("option", { name: "#8a6d3b", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const configured = await readFile(page, "Quick Notes.base");
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Welcome.md", data: "# My own start\n", directory: "DATA", encoding: "utf8" });
      await fs.deleteFile({ path: "vault/Tour/10 Sharing and automation.md", directory: "DATA" });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    await expect.poll(() => readFile(page, "Welcome.md")).toBe("# My own start\n");
    expect(await readFile(page, "Quick Notes.base")).toBe(configured);
    await expect(readFile(page, "Tour/10 Sharing and automation.md")).rejects.toThrow();
    await expect(page.getByText("Choose a starting structure", { exact: true })).toHaveCount(0);
  } finally {
    sql.close();
  }
});

test("a tour note supports a real self-review and accepted suggestion", async ({ page, context }) => {
  test.setTimeout(60_000);
  const sql = await createTour(page, context);
  try {
    await page.locator(".m-swipe-front").filter({ hasText: /^Welcome$/ }).first().click();
    const original = await readFile(page, "Welcome.md");
    await page.getByTestId("note-menu").click();
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await page.locator(".pv-comment-compose textarea").fill("Keep one useful next step.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByPlaceholder(/^Your name$/).fill("Tour learner");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.locator(".pv-comment-card__body")).toContainText("Keep one useful next step.");
    expect(await readFile(page, "Welcome.md")).toBe(original);
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await page.getByTestId("note-menu").click();
    await page.getByRole("button", { name: "Suggest", exact: true }).click();
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" My useful next step.");
    const send = page.getByRole("button", { name: /^Send suggestions/ });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(send).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByTestId("note-menu").click();
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    await page.getByRole("radio", { name: /^Suggestions/ }).click();
    expect(await readFile(page, "Welcome.md")).not.toContain("My useful next step.");
    await page.getByRole("button", { name: "Accept", exact: true }).first().click();
    await expect.poll(() => readFile(page, "Welcome.md")).toContain("My useful next step.");
  } finally {
    sql.close();
  }
});
