/**
 * The `test` every E2E spec of this app imports (stability plan R9): Playwright's
 * own, plus a fixed clock. Before each test the page clock is installed at
 * TEST_NOW (scripts/test-clock.mjs) and runs on from there; the zone is the
 * config's `timezoneId`. On the runner side, `testNow()` is the same moment as
 * the page's `new Date()`, so a value the test computes and a value the app
 * shows agree. A test that is about one moment sets it (`page.clock.setFixedTime`,
 * `page.clock.install`), on top of this default.
 *
 * The one escape: a test that is about the REAL clock says
 * `test.use({ testClock: "real" })` and why.
 */
import { test as base } from "@playwright/test";
import { TEST_NOW_MS, realDateNow } from "../../../../scripts/test-clock.mjs";

export * from "@playwright/test";

let anchor: { testMs: number; realMs: number } | null = null;

/** The test's "now" on the runner side: TEST_NOW plus the time this test has run. */
export function testNow(): Date {
  if (!anchor) throw new Error("testNow(): only inside a test that runs on the fixed clock");
  return new Date(anchor.testMs + (realDateNow() - anchor.realMs));
}

export const test = base.extend<{ testClock: "fixed" | "real"; installTestClock: void }>({
  testClock: ["fixed", { option: true }],
  installTestClock: [
    async ({ context, testClock }, use) => {
      if (testClock === "real") {
        anchor = null;
        await use();
        return;
      }
      anchor = { testMs: TEST_NOW_MS, realMs: realDateNow() };
      await context.clock.install({ time: TEST_NOW_MS });
      await use();
      anchor = null;
    },
    { auto: true },
  ],
});
