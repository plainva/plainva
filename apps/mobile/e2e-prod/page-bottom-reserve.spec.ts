import { test, expect } from "@playwright/test";

/**
 * A page that decides its own bottom edge must keep it.
 *
 * Four surfaces do not scroll and therefore end flush with the screen: the note
 * editor, the PIM calendar, the .base graph and the security wizard. Each said
 * so in one rule — and lost. The strip that the floating bar and the capture
 * button reserve was written on `.m-page` itself, behind two or three
 * selectors (`.m-app.has-fab .m-page`, `[data-window="medium"] .m-page`), so it
 * outweighed every variant except in a single combination: compact, no FAB.
 *
 * On a tablet that meant a dead strip of 64px under an open note and 84px under
 * the calendar; on a phone the calendar lost 164px. The editor and the time
 * grid simply ended that far above the screen edge — reported from the iPad on
 * 2026-08-24 as content cut off at the bottom.
 *
 * The fix moved the reservation to a variable on `.m-app`, which leaves exactly
 * one padding rule on `.m-page` for the variants to override. That is a
 * cascade property, so no unit test can see it: jsdom has no cascade. This one
 * asks the real engine, against the production bundle, for every combination.
 */
const RESERVE_NONE = "0px";
const RESERVE_WIZARD = "16px";

test("only pages without their own bottom edge reserve the floating strip", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  const measured = await page.evaluate(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-window");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(host);

    const variants = ["", "m-page--note", "m-page--pimcal", "m-page--basegraph", "m-page--wizard"];
    const out: Record<string, string> = {};
    for (const win of ["compact", "medium", "expanded"]) {
      root.setAttribute("data-window", win);
      for (const fab of [false, true]) {
        const app = document.createElement("div");
        app.className = fab ? "m-app has-fab" : "m-app";
        host.appendChild(app);
        for (const variant of variants) {
          const el = document.createElement("div");
          el.className = variant ? `m-page ${variant}` : "m-page";
          app.appendChild(el);
          out[`${win}|${fab ? "fab" : "nofab"}|${variant || "plain"}`] =
            getComputedStyle(el).paddingBottom;
        }
      }
    }

    host.remove();
    if (previous) root.setAttribute("data-window", previous);
    return out;
  });

  // A scrolling page keeps reserving what floats over its end — unchanged.
  expect(measured["compact|nofab|plain"]).toBe("92px"); // --m-bar-space
  expect(measured["compact|fab|plain"]).toBe("164px"); // --m-fab-space
  expect(measured["medium|nofab|plain"]).toBe("64px"); // bar stands aside
  expect(measured["medium|fab|plain"]).toBe("84px"); // only the FAB overhangs
  expect(measured["expanded|nofab|plain"]).toBe("64px");
  expect(measured["expanded|fab|plain"]).toBe("84px");

  // The four surfaces that end flush keep their own edge in EVERY combination.
  for (const win of ["compact", "medium", "expanded"]) {
    for (const fab of ["nofab", "fab"]) {
      expect(measured[`${win}|${fab}|m-page--note`]).toBe(RESERVE_NONE);
      expect(measured[`${win}|${fab}|m-page--pimcal`]).toBe(RESERVE_NONE);
      expect(measured[`${win}|${fab}|m-page--basegraph`]).toBe(RESERVE_NONE);
      expect(measured[`${win}|${fab}|m-page--wizard`]).toBe(RESERVE_WIZARD);
    }
  }
});

/**
 * The formatting bar is `position: fixed`, so the editor has to end above it —
 * while it is there. The reserve used to be unconditional and cost every note
 * in READ mode a second dead strip of `--m-docked-h` (64px), on top of the page
 * reservation above. Both halves showed up in the same report.
 *
 * This half of the guarantee is measured, not the whole one: swapping the flag
 * for `editable` leaves this test GREEN, because the two only differ on a PLAIN
 * TEXT file, which the seeded vault has none of — a markdown note in read mode
 * is `editable: false` either way. What pins the coupling itself is the source
 * assertion in `mobileLint.test.ts` (\"lets the same flag decide the bar AND the
 * space it needs\"): the bar and the reserve must hang off ONE flag, so a text
 * file cannot end up reserving room for a bar it never gets. Together they
 * cover it; alone, neither does.
 */
test("the editor reserves the formatting bar only while it is on screen", async ({ page }) => {
  // Past the first start: the onboarding card covers the note list and would
  // swallow the click that opens a note (established pattern, see swipe-gesture).
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "de", motion: "off" }),
    );
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  // The release-highlights sheet arrives a moment after the first paint on a
  // fresh profile and covers everything. Settle, dismiss, then insist that no
  // backdrop is left over whichever way the race went.
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // Any seeded note will do — the reserve is a property of the surface, not of
  // a particular file. The "recently opened" carousel holds one from the moment
  // the welcome vault is seeded, and unlike the list below it never leads with a
  // FOLDER, so this stays independent of the seed's shape.
  const card = page.locator(".m-caro-card").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();

  const editor = page.locator(".m-page--note .m-editor");
  await expect(editor).toBeVisible({ timeout: 10000 });

  // Read mode: no bar, no reserve — the note uses the full height.
  await expect(editor).not.toHaveClass(/is-docked/);
  const readGap = await editor.evaluate(
    (el) => window.innerHeight - el.getBoundingClientRect().bottom,
  );
  expect(readGap).toBeLessThanOrEqual(1); // sub-pixel rounding only

  // Edit mode: the bar is on screen, so the reserve comes back with it.
  await page.getByTestId("note-edit").click();
  await expect(editor).toHaveClass(/is-docked/);
  await expect(page.locator(".m-edit-toolbar")).toBeVisible();
  const scrollerBottom = await page
    .locator(".m-page--note .cm-scroller")
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const barTop = await page
    .locator(".m-edit-toolbar")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(scrollerBottom).toBeLessThanOrEqual(barTop);
});
