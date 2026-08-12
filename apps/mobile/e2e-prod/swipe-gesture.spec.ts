import { test, expect, type Page } from "@playwright/test";

/**
 * The swipe row has to answer a real FINGER.
 *
 * `SwipeRow` was complete and correct — axis detection, dead zone, haptics,
 * destructive action last — and it did nothing on a phone. Measured with a real
 * touch drag, the WebView answered `pointerdown`, two `pointermove` and then a
 * `pointercancel`: it had claimed the drag for the list's own scrolling,
 * because `.m-swipe-front` declared no `touch-action`. The axis detection never
 * received its third event, the row never moved, and the maintainer reported an
 * app whose rows "are simply not swipeable".
 *
 * Nothing caught it, and the reason is the point of this file: every automated
 * check we have drives a MOUSE, and a mouse never passes through the browser's
 * gesture arbitration — `touch-action` is not consulted at all. A mouse-driven
 * version of this very test would pass with the defect in place.
 *
 * So this one drives touch through CDP `Input.dispatchTouchEvent`, which goes
 * through the compositor exactly as a finger does. It runs against the
 * PRODUCTION bundle for the same reason the smoke check next to it does.
 */

/** A genuine touch drag: CDP, so the compositor arbitrates the gesture. */
async function touchDrag(page: Page, x: number, y: number, dx: number, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const point = (px: number) => ({ x: px, y, radiusX: 12, radiusY: 12, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(x)] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(x + (dx * i) / steps)],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("a touch drag opens a swipe row's actions", async ({ page }) => {
  // Past the first-start screen. Without this the rows are in the DOM and even
  // count as visible, while the onboarding card covers the very coordinates the
  // drag aims at — the gesture then lands on a surface that legitimately has no
  // swipe, and the test reports the defect it is meant to detect.
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "de", motion: "off" }),
    );
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  // The release-highlights sheet covers every surface on a fresh profile and
  // would swallow the gesture. It arrives a moment AFTER the first paint, so
  // asking whether it is there right away is a race — and a lost race does not
  // fail here, it fails later as a cancelled drag, which reads exactly like the
  // defect this test exists to catch. Settle first, dismiss, then insist that
  // no backdrop is left over whichever way it went.
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // The welcome vault seeds notes, and a note row IS a swipe row. Waiting for
  // the row rather than a screen keeps this independent of which surface the
  // start-up race happens to win.
  const front = page.locator(".m-swipe-front").first();
  await expect(front).toBeVisible({ timeout: 20000 });

  await page.evaluate(() => {
    (globalThis as unknown as { __pev: string[] }).__pev = [];
    for (const type of ["pointerdown", "pointermove", "pointercancel", "pointerup"]) {
      window.addEventListener(
        type,
        () => (globalThis as unknown as { __pev: string[] }).__pev.push(type),
        true,
      );
    }
  });

  const box = (await front.boundingBox())!;
  await touchDrag(page, box.x + box.width - 40, box.y + box.height / 2, -140);
  await page.waitForTimeout(400);

  const seen = await page.evaluate(() => (globalThis as unknown as { __pev: string[] }).__pev);
  const transform = await front.evaluate((el) => getComputedStyle(el).transform);

  // The three assertions are the three halves of the measurement, in the order
  // they failed: the browser must not take the gesture away, the row must move,
  // and the actions must be reachable.
  expect(
    seen,
    `the browser cancelled the drag — is \`touch-action\` missing on .m-swipe-front? events: ${seen.join(" ")}`,
  ).not.toContain("pointercancel");
  expect(
    transform,
    `the row did not move (transform ${transform}); a swipe row that does not move has no actions`,
  ).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await expect(page.locator(".m-swipe-act").first()).toBeVisible();
});

/*
 * The task row got its swipe in S23, and it is the row most likely to lose the
 * gesture: it carries a checkbox, chips and a trailing button of its own. It is
 * NOT measured here, and the reason is structural rather than an oversight — the
 * task list is fed by the FTS index, and the SQLite plugin has no plain-web
 * backing store, so on this harness the tasks screen is honestly empty ("0
 * Aufgaben"). A conditional skip would read as a pass and prove nothing.
 *
 * So it stands as UNMEASURED and belongs to the device pass. What IS pinned
 * here is the mechanism the task row uses — one `SwipeRow`, one `touch-action`,
 * one axis arbitration — and `swipeCoverage.test.ts` pins that the task rows
 * are wrapped in it.
 */
