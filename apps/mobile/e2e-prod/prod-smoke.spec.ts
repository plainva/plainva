import { test, expect } from "@playwright/test";

/**
 * Production-build smoke check for the MOBILE shell.
 *
 * The mobile package had no such check, and that is the gap this file closes.
 * The desktop got one after v0.3.0 shipped a white window; mobile kept none,
 * so when a dependency bump made rolldown split React's CommonJS shim away
 * from react-i18next's interop call, the phone app stopped mounting from a
 * production build entirely — `TypeError: ae is not a function` — while the
 * dev server, every unit test and the whole CI stayed green. Only a screenshot
 * run that happened to build the bundle found it (rework round 2, N9.4/Z1).
 *
 * There is no Tauri here and no Capacitor native layer: the plugins fall back
 * to their web implementations, so the app really does boot in a plain browser.
 * A bundle-evaluation failure throws outside every handler and arrives as an
 * uncaught pageerror with an empty #root — which is exactly what this asserts.
 * Console errors are NOT asserted on: without the native layer some plugins
 * log handled failures, and that is the app working, not a defect.
 */
test("production bundle boots and mounts the app without an uncaught error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

  await page.goto("/");

  // Something real has to be on screen. The first start seeds a welcome vault
  // asynchronously, so allow a generous wait rather than pinning a screen: the
  // question here is whether the bundle evaluated and React mounted, not which
  // surface won the race.
  try {
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  } catch (error) {
    throw new Error(
      `${String(error)}\nUncaught page errors during startup:\n${pageErrors.join("\n") || "(none)"}`,
      { cause: error },
    );
  }

  expect(
    pageErrors,
    `Uncaught page errors during startup:\n${pageErrors.join("\n")}`,
  ).toEqual([]);
});
