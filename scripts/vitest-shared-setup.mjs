// First setup file of every vitest config (core, desktop, mobile): what every
// unit test inherits without doing anything (stability plan R9).
import { beforeEach, expect } from "vitest";
import { TEST_NOW_MS, TEST_TIME_ZONE, installShiftedDate } from "./test-clock.mjs";

// 1. The clock. The config pinned TZ before the workers started; a worker that
// did not get it would run every date test in the wrong zone without saying so.
if (process.env.TZ !== TEST_TIME_ZONE) process.env.TZ = TEST_TIME_ZONE;
const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
if (zone !== TEST_TIME_ZONE && !(TEST_TIME_ZONE === "UTC" && zone === "Etc/UTC")) {
  throw new Error(`test clock: this worker runs in ${zone}, the tests expect ${TEST_TIME_ZONE}`);
}
// Each test file starts at TEST_NOW and runs on from there (scripts/test-clock.mjs).
installShiftedDate(TEST_NOW_MS);

// 2. No test passes by checking nothing. A guard over every locale ran its
// assertions in a loop over an un-awaited promise, which is an empty object,
// and was green for months (deleteMessages.test.ts, Sammelplan 3.179 Nr. 7):
// a test whose every assertion sits in a loop over something empty makes no
// assertion at all, and now fails for it.
beforeEach(() => {
  expect.hasAssertions();
});
