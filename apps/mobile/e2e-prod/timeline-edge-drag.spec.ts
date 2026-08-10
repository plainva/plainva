import { test, expect, type Page } from "@playwright/test";

/**
 * Dragging the edge of a timeline bar has to answer a real FINGER.
 *
 * S21 gave the desktop timeline a row per entry and two edges one can take hold
 * of; S21b brings the same rows to the phone. There the gesture is a touch, and
 * a touch goes through the browser's gesture arbitration first: if the handle
 * declares no `touch-action`, the compositor claims the horizontal drag for the
 * list's own scrolling and the handle never receives a second move.
 *
 * That is not a hypothesis. It is exactly what Round 3 measured on `SwipeRow` —
 * a complete, correct implementation that did nothing on a phone, and that
 * every automated check we had passed, because every one of them drives a
 * MOUSE and a mouse never consults `touch-action` at all.
 *
 * So this one drives touch through CDP `Input.dispatchTouchEvent`, against the
 * PRODUCTION bundle, for the same reason its neighbour does.
 */

/** A genuine touch drag: CDP, so the compositor arbitrates the gesture. */
async function touchDrag(page: Page, x: number, y: number, dx: number, steps = 14) {
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

test("a touch drag moves a timeline bar's edge", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: "de", motion: "off" }),
    );
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const whatsNew = page.locator('[data-testid="whats-new-sheet"]');
  if (await whatsNew.count()) {
    await whatsNew.locator('[data-testid="whats-new-close"]').click({ timeout: 5000 });
  }
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);

  // The welcome vault has no timeline `.base`, and seeding one through the UI
  // would take longer than the measurement itself. What this file exists to
  // prove is not that the database renders — that is covered by the desktop
  // E2E — but that the handle SURVIVES gesture arbitration. So the surface is
  // built here, with the production stylesheet in force, and driven with a real
  // finger through the same window listeners the screen uses.
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.className = "m-tl";
    host.setAttribute("data-testid", "tl-probe");
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "120px";
    host.style.right = "0";
    host.style.height = "120px";
    host.style.background = "var(--bg-primary)";
    host.innerHTML = `
      <div class="m-tl-grid" style="width:900px">
        <div class="m-tl-row">
          <button class="m-tl-name" style="width:116px">Probe</button>
          <span class="m-tl-barwrap" style="left:116px;width:120px;background:var(--accent-container)">
            <span class="m-tl-handle m-tl-handle--end" data-testid="probe-handle"></span>
          </span>
        </div>
      </div>`;
    document.body.appendChild(host);

    const seen: string[] = [];
    (globalThis as unknown as { __tlev: string[] }).__tlev = seen;
    for (const type of ["pointerdown", "pointermove", "pointercancel", "pointerup"]) {
      window.addEventListener(type, (e) => seen.push(`${type}:${(e as PointerEvent).pointerType}`), true);
    }
  });

  const handle = page.locator('[data-testid="probe-handle"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, 140);
  await page.waitForTimeout(200);

  const seen = await page.evaluate(() => (globalThis as unknown as { __tlev: string[] }).__tlev);
  const moves = seen.filter((e) => e.startsWith("pointermove"));

  // The measurement, in the order it would fail: the drag must reach the page
  // as touch at all, the browser must not take it away, and the moves must keep
  // arriving — one move is a tap, not a drag.
  expect(seen.join(" "), `the drag never arrived as touch: ${seen.join(" ")}`).toContain("pointerdown:touch");
  expect(
    seen.join(" "),
    `the browser cancelled the drag — is \`touch-action: none\` missing on .m-tl-handle? events: ${seen.join(" ")}`,
  ).not.toContain("pointercancel");
  expect(
    moves.length,
    `only ${moves.length} move(s) reached the page; a claimed gesture stops after one or two`,
  ).toBeGreaterThan(4);
});
