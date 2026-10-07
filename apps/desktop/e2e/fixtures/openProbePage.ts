import type { Page } from "@playwright/test";

/**
 * Opens a probe page and waits until its probe has announced itself.
 *
 * A probe page is a bare HTML shell that imports one fixture module from the
 * Vite dev server. That import can fail for a reason that has nothing to do
 * with the code under test: the first time the server sees a fixture's
 * imports it may re-optimise its dependencies and reload the page, and the
 * import that was in flight is gone ("Failed to fetch dynamically imported
 * module"). The shell has no second attempt of its own, so the probe never
 * appeared and the test spent its whole budget waiting for it — in CI on
 * 2026-09-18 and again on 2026-09-30, each time before the first assertion
 * about the product had run.
 *
 * So the page is loaded again, at most twice, and each time that happens it
 * is said out loud: a probe that needs its second load is the dev server's
 * business, one that needs none of the three is the fixture's.
 */
export async function openProbePage(page: Page, path: string, ready: () => boolean): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.goto(path);
    try {
      await page.waitForFunction(ready, undefined, { timeout: 12_000 });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`probe page ${path}: not ready after 12 s (load ${attempt} of ${attempts}), loading it again`);
    }
  }
}
