import { test, expect } from "./clockedTest";

/**
 * A notice stands clear of the floating bar and of the "+" (Sammelplan § 3.48).
 *
 * The shared notices sat on the desktop's clearance - the status bar, 28 px -,
 * so on the phone every notice lay over the floating navigation bar for as long
 * as it stood: "Sending in 8 s · Undo" over the tabs, a "Not sent" notice over
 * the reader's bar. The phone names its own clearance now, the strip its pages
 * reserve. Where the notices stand is a cascade property of the real engine,
 * so this asks the production bundle, in each window class, with and without
 * the "+".
 */
test("a notice stands above the floating bar and the capture button", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  const bar = page.locator(".m-tabbar:not(.m-tabbar--rail)");
  await expect(bar).toBeVisible();

  const measured = await page.evaluate(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-window");
    const app = document.querySelector<HTMLElement>(".m-app")!;
    const hadFab = app.classList.contains("has-fab");
    // A notice like the ones ToastHost renders, measured where the stylesheet puts it.
    const host = document.createElement("div");
    host.className = "pv-toasts";
    const notice = document.createElement("div");
    notice.className = "pv-toast";
    notice.textContent = "Sending in 8 s";
    host.appendChild(notice);
    document.body.appendChild(host);
    const tabbar = document.querySelector<HTMLElement>(".m-tabbar:not(.m-tabbar--rail)")!;
    const barTop = tabbar.getBoundingClientRect().top;
    const out: Record<string, { bottom: number }> = {};
    for (const win of ["compact", "medium", "expanded"]) {
      root.setAttribute("data-window", win);
      for (const fab of [false, true]) {
        app.classList.toggle("has-fab", fab);
        out[`${win}|${fab ? "fab" : "nofab"}`] = { bottom: window.innerHeight - parseFloat(getComputedStyle(host).bottom) };
      }
    }
    host.remove();
    app.classList.toggle("has-fab", hadFab);
    if (previous) root.setAttribute("data-window", previous);
    else root.removeAttribute("data-window");
    const fabProbe = document.createElement("button");
    fabProbe.className = "pv-fab m-fab-float m-fab-float--above-tabs";
    fabProbe.style.visibility = "hidden";
    fabProbe.textContent = "+";
    document.body.appendChild(fabProbe);
    const fabTop = fabProbe.getBoundingClientRect().top;
    fabProbe.remove();
    return { out, barTop, fabTop, height: window.innerHeight };
  });

  // Compact: the bar floats over the page, the notice stands above it - and
  // above the "+" that floats over the bar where the screen has one.
  expect(measured.out["compact|nofab"].bottom).toBeLessThanOrEqual(measured.barTop);
  expect(measured.out["compact|fab"].bottom).toBeLessThanOrEqual(measured.fabTop);
  // From medium the bar is a rail at the side: nothing below but the edge (and the "+").
  for (const win of ["medium", "expanded"]) {
    expect(measured.out[`${win}|nofab`].bottom).toBeGreaterThan(measured.out["compact|nofab"].bottom);
    expect(measured.out[`${win}|fab`].bottom).toBeLessThan(measured.out[`${win}|nofab`].bottom);
  }
});
