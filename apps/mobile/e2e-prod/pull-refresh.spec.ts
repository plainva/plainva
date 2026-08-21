import { test, expect } from "@playwright/test";

/**
 * The refresh indicator hangs BELOW the app bar.
 *
 * It is an ordinary flow element that grows from zero, so wherever it is
 * rendered is what it pushes. Rendered as the page's first child it pushed the
 * sticky bar down and drew itself in the strip the bar reserves for the status
 * area — on an edge-to-edge Android that strip is the camera, and that is what
 * the maintainer photographed on 2026-08-21: a spinner behind the lens and a
 * bar shoved down the screen.
 *
 * `mobileLint` holds the SHAPE (the indicator never opens a page). This holds
 * the GEOMETRY, and it has to, because the shape only implies the position
 * once the bar is sticky and carries the safe-area inset — three facts no
 * source scan can put together. Touch goes through CDP so the compositor
 * arbitrates the gesture exactly as a finger does; a mouse drag never reaches
 * the handler at all.
 */

/** Pulls down at (x, y) and leaves the finger DOWN, so the pull can be measured. */
async function touchPullHold(page: import("@playwright/test").Page, x: number, y: number, dy: number, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const point = (py: number) => ({ x, y: py, radiusX: 12, radiusY: 12, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(y)] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(y + (dy * i) / steps)],
    });
    await page.waitForTimeout(16);
  }
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
}

test("a pull draws the indicator under the bar, never over it", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "de", motion: "off" }),
    );
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });

  // The release-highlights sheet covers every surface on a fresh profile and
  // would swallow the gesture; it arrives a moment after the first paint.
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  const bar = page.locator(".m-appbar").first();
  await expect(bar).toBeVisible({ timeout: 20000 });
  const barBefore = (await bar.boundingBox())!;

  const release = await touchPullHold(page, 180, Math.round(barBefore.y + barBefore.height + 40), 140);
  try {
    const ptr = page.locator(".m-ptr");
    await expect(ptr).toBeVisible({ timeout: 5000 });
    const ptrBox = (await ptr.boundingBox())!;
    const barBox = (await bar.boundingBox())!;

    // The whole finding in one line: the indicator starts where the bar ends.
    expect(ptrBox.y, "the indicator draws over the app bar").toBeGreaterThanOrEqual(
      barBox.y + barBox.height - 1,
    );
    // And the bar itself did not move — it used to be pushed down by the pull,
    // which is how it ended up under the camera cut-out.
    expect(Math.abs(barBox.y - barBefore.y), "the pull moved the app bar").toBeLessThanOrEqual(1);
  } finally {
    await release();
  }
});
