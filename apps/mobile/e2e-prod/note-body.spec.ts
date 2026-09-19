import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The note body on the phone (finding 2026-09-19, plan Rueckmeldungen P8).
 *
 * The phone always shows the live editor, so until now it never had a callout
 * CARD at all - only a bar per line. At phone width: the card is one silhouette
 * built from its lines and stays inside the screen, a done task is muted and
 * struck through, and a nested list level carries its indent guide.
 */
test("a callout is one card at phone width, a done task reads like one, nested levels get a guide", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const note = [
    "# Body",
    "",
    "> [!info] Maintenance window",
    "> Saturday from six in the evening, and the practice has been told about it well in advance.",
    "> Second line.",
    "",
    "- [x] export mailboxes",
    "- [ ] switch over",
    "",
    "- follow-up",
    "  - set up clients",
    "",
  ].join("\n");
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Body.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, note);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByRole("button", { name: /^Search$/ }).first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("practice has been told");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Body");
    await page.locator("[data-search-occurrence]").first().click();

    const lines = page.locator(".cm-content .cm-callout");
    await expect(lines).toHaveCount(3, { timeout: 15000 });
    const shape = await lines.evaluateAll((els: Element[]) => els.map((el) => {
      const s = getComputedStyle(el);
      return [s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderTopLeftRadius, s.borderBottomLeftRadius].join(" ");
    }));
    expect(shape).toEqual(["1px 0px 1px 12px 0px", "0px 0px 1px 0px 0px", "0px 1px 1px 0px 12px"]);
    // The card stays inside the screen: the long line wraps, nothing scrolls sideways.
    const overflow = await page.locator(".cm-scroller").first().evaluate((el: Element) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const edges = await lines.first().evaluate((el: Element) => { const r = el.getBoundingClientRect(); return [r.left, window.innerWidth - r.right]; });
    expect(edges[0]).toBeGreaterThanOrEqual(0);
    expect(edges[1]).toBeGreaterThanOrEqual(0);

    const done = page.locator(".cm-content .cm-md-task-done");
    await expect(done).toHaveText(["export mailboxes"]);
    expect(await done.evaluate((el: Element) => getComputedStyle(el).textDecorationLine)).toBe("line-through");

    const guide = await page.locator(".cm-content .cm-line", { hasText: "set up clients" }).first().evaluate((el: Element) => getComputedStyle(el).backgroundImage);
    expect(guide).toContain("linear-gradient");
  } finally { sql.close(); }
});
