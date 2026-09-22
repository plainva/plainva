import type { PinboardProbeWindow } from "./fixtures/pinboardProbe";
import { test, expect, type Page } from "@playwright/test";

export async function loadPinboardProbe(page: Page) {
  await page.route("**/__pinboard_probe", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}#host{height:100%;width:100%;display:flex;min-height:0}</style>
    </head><body><div id="host"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    await import('/e2e/fixtures/pinboardProbe.tsx');</script></body></html>` }));
  page.on("pageerror", error => console.log("Probe error:", error.message));
  await page.goto("/__pinboard_probe");
  await page.waitForFunction(() => !!(window as PinboardProbeWindow).pinboardProbe);
}
// Desktop only since 2026-09-22: the phone's pinboard has no field of its own
// any more — its screen's head carries the search for every view, and that
// path is covered in apps/mobile/e2e-prod/board-card-color.spec.ts. What is
// left here is the EMBEDDED board, which has no head to put a magnifier in
// and therefore keeps a field; the hook under both is the same.
for (const shell of ["desktop"] as const) {
  test(`${shell}: search finds unseen body text, composes with chips and survives returning`, async ({ page }) => {
    await page.setViewportSize({ width: shell === "mobile" ? 375 : 900, height: 812 });
    await loadPinboardProbe(page);
    await page.evaluate(shell => (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 100, embedded: true }), shell);
    const search = page.locator('[data-pinboard-search]');
    await search.fill('needle-tail');
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(1);
    await expect(page.locator('[data-pinboard-card]')).toHaveAttribute('data-pinboard-path', 'Inbox/Note-99.md');
    await page.locator('[data-pinboard-chip="group0"]').click();
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(0);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(50);
    await page.locator('[data-pinboard-chip="group0"]').click();
    await search.fill('needle-tail');
    await expect(page.locator('[data-card-status="ready"]')).toHaveCount(1);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath(`pinboard-${shell}.png`) });
    await page.locator('[data-pinboard-card]').click();
    await page.evaluate(shell => (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 100, embedded: true }), shell);
    await expect(search).toHaveValue('needle-tail');
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(1);
    await page.getByRole('button', { name: /Clear search|Suche löschen/ }).click();
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(100);
  });
  test(`${shell}: pinboard loads visible previews and keeps filtered return state`, async ({ page }) => {
    await page.setViewportSize({ width: shell === "mobile" ? 375 : 900, height: 812 });
    await loadPinboardProbe(page);
    await page.evaluate(shell => (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 100 }), shell);
    await expect(page.locator('[data-card-status="ready"]').first()).toBeVisible();
    await expect(page.locator('[data-pinboard-card] img').first()).toBeVisible();
    const initial = await page.evaluate(() => ({ paths: new Set((window as PinboardProbeWindow).pinboardProbe.requests.flat()).size, images: (window as PinboardProbeWindow).pinboardProbe.imageRequests }));
    expect(initial.paths).toBeLessThan(100);
    // Card previews and images have independent observers. Read-operation
    // counts need not be smaller than the number of distinct loaded notes.
    // A distant image must stay unread until scrolling brings it into view.
    const distantCard = page.locator('[data-pinboard-path="Inbox/Note-99.md"]');
    await expect(distantCard).toHaveAttribute('data-card-status', 'loading');
    expect(initial.images).not.toContain('Inbox/Note-99.png');
    // Follow the scroll container while loaded heights settle. Masonry can
    // move a card between columns and replace its DOM node during this step.
    await expect.poll(() => page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('#host > div')!;
      container.scrollTop = container.scrollHeight;
      return (window as PinboardProbeWindow).pinboardProbe.imageRequests.includes('Inbox/Note-99.png');
    })).toBe(true);
    await expect(distantCard).toHaveAttribute('data-card-status', 'ready');
    await expect(distantCard.locator('img')).toBeInViewport();
    await page.evaluate(() => { document.querySelector<HTMLElement>('#host > div')!.scrollTop = 0; });
    await page.locator('[data-pinboard-chip="group1"]').click();
    await page.evaluate(() => { document.querySelector<HTMLElement>('#host > div')!.scrollTop = 850; });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#host > div')!;
      const top = el.getBoundingClientRect().top;
      const card = [...el.querySelectorAll<HTMLElement>('[data-card-status="ready"]')].find(c => c.getBoundingClientRect().top >= top && c.getBoundingClientRect().bottom <= top + el.clientHeight)!;
      const data = { scroll: el.scrollTop, path: card.dataset.pinboardPath!, requests: (window as PinboardProbeWindow).pinboardProbe.requests.length, paths: (window as PinboardProbeWindow).pinboardProbe.requests.flat() };
      card.click(); return data;
    });
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(0);
    await page.evaluate(shell => (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 100 }), shell);
    await expect(page.locator('[data-pinboard-card]')).toHaveCount(50);
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('#host > div')!.scrollTop)).toBeCloseTo(before.scroll, -1);
    await page.waitForTimeout(350);
    const extra = await page.evaluate(n => (window as PinboardProbeWindow).pinboardProbe.requests.slice(n).flat(), before.requests);
    expect(extra.filter((path: string) => before.paths.includes(path))).toEqual([]);
    const cached = await page.evaluate(() => {
      const requests = (window as PinboardProbeWindow).pinboardProbe.requests;
      return { count: requests.length, paths: requests.flat() };
    });
    await page.evaluate(({ shell, path }) => { (window as PinboardProbeWindow).pinboardProbe.change(path); (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 100 }); }, { shell, path: before.path });
    // Layout may expose previously unseen cards. Of the already cached cards,
    // only the changed note may be requested again, exactly once.
    await expect.poll(() => page.evaluate(cached => (window as PinboardProbeWindow).pinboardProbe.requests
      .slice(cached.count).flat().filter(path => cached.paths.includes(path)), cached)).toEqual([before.path]);
    await expect(page.locator('[data-pinboard-card]').filter({ hasText: 'Card body 1.' })).toHaveCount(1);
  });
  test(`${shell}: missing index entries stay distinct and failed loads can be retried`, async ({ page }) => {
    await loadPinboardProbe(page);
    await page.evaluate(shell => { (window as PinboardProbeWindow).pinboardProbe.missing('Inbox/Note-0.md'); (window as PinboardProbeWindow).pinboardProbe.mount({ shell, count: 4 }); }, shell);
    await expect(page.locator('[data-pinboard-path="Inbox/Note-0.md"]')).toHaveAttribute('data-card-status', 'missing');
    await expect(page.locator('[data-card-status="ready"]')).toHaveCount(3);
    await page.evaluate(shell => { const probe = (window as PinboardProbeWindow).pinboardProbe; probe.reset(); probe.fail(true); probe.mount({ shell, count: 4 }); }, shell);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.evaluate(() => (window as PinboardProbeWindow).pinboardProbe.fail(false));
    await page.getByRole('alert').getByRole('button').click();
    await expect(page.locator('[data-card-status="ready"]')).toHaveCount(4);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
