import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Nothing that can be touched stands under the status bar.
 *
 * TestFlight 2026-09-27: the find panel of an open note was drawn at the very
 * top of the screen, under the clock and the Dynamic Island - its field and
 * its close button out of reach. The cause was one surface (a panel at the top
 * of an editor that, in read mode, starts at the top of the screen); the class
 * is "a surface that forgets the strip the system draws over".
 *
 * A browser has no notch, so the app's ONE name for that strip, `--m-safe-top`
 * (mobile.css; `mobileLint` keeps every rule on it), is set to the height of a
 * Dynamic Island here, and the screens are walked: at rest, no control a
 * person could tap may begin above that line.
 */
const NOTCH = 59;

async function withNotch(page: Page) {
  await page.addStyleTag({ content: `:root { --m-safe-top: ${NOTCH}px !important; }` });
}

/** Controls that are on screen, can be hit, and begin inside the status strip. */
const underTheNotch = (page: Page) =>
  page.evaluate((notch) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [role='button'], [role='switch'], [contenteditable='true']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= notch) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.pointerEvents === "none" || Number(style.opacity) === 0) continue;
      // Only what a finger would actually reach there.
      const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
      const y = Math.max(r.top + 1, 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) continue;
      out.push(`${el.tagName.toLowerCase()}.${el.className || "-"}[${el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.textContent?.trim().slice(0, 24) ?? ""}] top=${Math.round(r.top)}`);
    }
    return out;
  }, NOTCH);

async function start(page: Page) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const text = "# Reader\n\n" + Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with a needle in it.`).join("\n\n");
    await fs.writeFile({ path: "vault/Reader.md", data: text, directory: "DATA", encoding: "utf8", recursive: true });
  });
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  await withNotch(page);
}

test("the find panel of a note stands under the note's bar, clear of the status strip, and can be used", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await start(page);
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Reader", { exact: true }) }).first().click();
    const pageEl = page.locator(".m-page--note");
    await expect(page.getByTestId("note-menu")).toBeVisible();
    // Read mode: the bar floats over the text.
    await expect(pageEl).toHaveAttribute("data-reader-overlay", "true");
    expect(await underTheNotch(page)).toEqual([]);

    await page.getByTestId("note-menu").click();
    await page.locator(".m-sheet .m-row", { hasText: /^Find$/ }).click();
    const panel = page.locator(".m-editor .cm-panel.cm-search");
    await expect(panel).toBeVisible();

    // The panel has a place of its own: below the bar, which stands in the flow.
    await expect(pageEl).not.toHaveAttribute("data-reader-overlay", "true");
    const bar = (await page.locator(".m-note-chrome").boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(NOTCH);
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(await underTheNotch(page)).toEqual([]);

    // Every control of the panel is the top-most thing where it stands.
    const covered = await panel.evaluate((el) => {
      const bad: string[] = [];
      for (const control of el.querySelectorAll<HTMLElement>("input, button")) {
        const r = control.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === control || control.contains(hit) || hit.closest("label")?.contains(control))) bad.push(control.getAttribute("name") ?? control.tagName);
      }
      return bad;
    });
    expect(covered).toEqual([]);

    // It works: a query finds its matches in the text.
    await panel.locator('input[name="search"]').pressSequentially("needle");
    await expect(page.locator(".cm-searchMatch").first()).toBeVisible();

    // Closing it gives the reader its floating bar back.
    await panel.locator('button[name="close"]').click();
    await expect(panel).toHaveCount(0);
    await expect(pageEl).toHaveAttribute("data-reader-overlay", "true");
  } finally {
    await sql.close();
  }
});

test("no control begins under the status strip on the tab roots, the search page and the settings", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await start(page);
    const offenders: Record<string, string[]> = {};
    const check = async (name: string) => {
      await page.waitForTimeout(250);
      const bad = await underTheNotch(page);
      if (bad.length) offenders[name] = bad;
    };
    await check("start");

    // Every tab of the bar, whatever the bar holds.
    const tabs = page.locator(".m-tabbar .m-tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click();
      // The last tab opens the areas sheet; a sheet hangs from the bottom.
      await check(`tab ${i}`);
      const backdrop = page.locator(".m-sheet-backdrop");
      if (await backdrop.count()) await backdrop.first().click({ position: { x: 4, y: 4 } });
    }

    // The search page: its field lives in the app bar.
    await tabs.first().click();
    const search = page.locator(".m-appbar").first().getByRole("button", { name: /search/i }).first();
    if (await search.count()) {
      await search.click();
      await check("search");
      await page.goBack();
    }
    expect(offenders).toEqual({});
  } finally {
    await sql.close();
  }
});
