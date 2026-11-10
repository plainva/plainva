import { test, expect } from "./clockedTest";

/**
 * The phone's boot guard (public/boot-guard.js) shows "Plainva didn't start"
 * when nothing rendered within twelve seconds. Until 3.91 it never took that
 * overlay back: a first start slower than that on a cheap phone left it over
 * the running app for good, swallowing every tap. The desktop's guard has
 * cleared it since 2026-08-24; both now share the rule that only an error
 * BEFORE the first render keeps it.
 *
 * The entry module is held until the test has seen the overlay, then let go.
 */
const OVERLAY = "#plainva-boot-failure";
const ENTRY_PATTERNS = ["**/src/main.tsx*", "**/assets/index-*.js*"];

async function holdEntry(page: import("@playwright/test").Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const pattern of ENTRY_PATTERNS) {
    await page.route(pattern, async (route) => {
      await released;
      await route.continue();
    });
  }
  return release;
}

test("a late first render takes the timeout's overlay back", async ({ page }) => {
  test.setTimeout(60_000);
  const release = await holdEntry(page);
  await page.goto("/", { waitUntil: "commit" });
  const overlay = page.locator(OVERLAY);
  await expect(overlay.filter({ hasText: "No error was reported" })).toBeVisible({ timeout: 20_000 });

  release();
  await expect(page.locator("#root > *").first()).toBeAttached({ timeout: 20_000 });
  await expect(overlay).toHaveCount(0, { timeout: 5_000 });
});

test("an error right after the late first render does not hold the overlay", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const watch = new MutationObserver(() => {
      const root = document.getElementById("root");
      if (!root || !root.firstElementChild) return;
      watch.disconnect();
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("right after the first render") }));
    });
    watch.observe(document, { childList: true, subtree: true });
  });
  const release = await holdEntry(page);
  await page.goto("/", { waitUntil: "commit" });
  const overlay = page.locator(OVERLAY);
  await expect(overlay.filter({ hasText: "No error was reported" })).toBeVisible({ timeout: 20_000 });

  release();
  await expect(page.locator("#root > *").first()).toBeAttached({ timeout: 20_000 });
  await expect(overlay).toHaveCount(0, { timeout: 5_000 });
});
