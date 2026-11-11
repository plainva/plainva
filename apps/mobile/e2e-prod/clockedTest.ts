/**
 * The `test` every E2E spec of this app imports (stability plan R9): Playwright's
 * own, plus a fixed clock. Before each test the page's Date is set to start at
 * TEST_NOW (scripts/test-clock.mjs, `installPageDate`) and runs on from there;
 * the zone is the config's `timezoneId`. On the runner side, `testNow()` is the
 * same moment as the page's `new Date()`, so a value the test computes and a
 * value the app shows agree. Only Date moves: timers and event time stamps stay
 * real. A test that is about one moment sets it with `page.clock`
 * (`setFixedTime`, `install`, …); the first such call hands the page over to
 * Playwright's clock, on the real Date.
 *
 * The one escape: a test that is about the REAL clock says
 * `test.use({ testClock: "real" })` and why.
 */
import { test as base, type BrowserContext } from "@playwright/test";
import { TEST_NOW_MS, installPageDate, realDateNow, releasePageDate } from "../../../scripts/test-clock.mjs";

export * from "@playwright/test";

let anchor: { testMs: number; realMs: number } | null = null;

/** The test's "now" on the runner side: TEST_NOW plus the time this test has run. */
export function testNow(): Date {
  if (!anchor) throw new Error("testNow(): only inside a test that runs on the fixed clock");
  return new Date(anchor.testMs + (realDateNow() - anchor.realMs));
}

const CLOCK_METHODS = ["install", "setFixedTime", "setSystemTime", "fastForward", "runFor", "pauseAt", "resume"] as const;

/** Before the test's first own clock call, the page gets its real Date back for Playwright's clock to wrap. */
function handOverOnFirstClockCall(context: BrowserContext): void {
  const clock = context.clock as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
  let handedOver = false;
  for (const name of CLOCK_METHODS) {
    const own = clock[name].bind(clock);
    clock[name] = async (...args: unknown[]) => {
      if (!handedOver) {
        handedOver = true;
        await context.addInitScript(releasePageDate);
        for (const page of context.pages()) await page.evaluate(releasePageDate).catch(() => undefined);
      }
      return own(...args);
    };
  }
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
      await context.addInitScript(installPageDate, anchor);
      handOverOnFirstClockCall(context);
      await use();
      anchor = null;
    },
    { auto: true },
  ],
});
