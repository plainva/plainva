// The one clock and the one time zone every test runs on (stability plan R9).
//
// Until 2026-11 the suites ran on the real clock and in whatever zone the
// machine had: CI in UTC, the maintainer's machine in Europe/Berlin. A test
// that is green at noon could be red at 22:30 UTC (it was, on 2026-11-06),
// and a test written in Berlin could pass there and fail in CI. Now:
//
// - every vitest config pins `process.env.TZ` and loads `vitest-shared-setup.mjs`
//   first, which starts the clock of each test file at TEST_NOW (it keeps
//   running from there: timers and elapsed-time code behave as before);
// - every Playwright config pins the zone of the runner (TZ) and of the page
//   (`timezoneId`), and the shared `test` of each app's E2E folder starts the
//   page's Date at TEST_NOW before each test (`installPageDate`), so the page
//   and `testNow()` on the runner side agree.
//
// Both are defaults: a test that is about a particular moment sets it
// (`vi.setSystemTime`, `page.clock.setFixedTime`), and the very few that are
// about the REAL clock say so (`realDateNow()` here, `test.use({ testClock: "real" })`
// in Playwright) - the lint rule `plainva/no-real-clock-in-tests` holds the rest.
//
// To flush out what the default hides, run a suite at another moment or in
// another zone:  PLAINVA_TEST_NOW=2026-10-25T02:30:00 PLAINVA_TEST_TZ=America/New_York
// (a wall time without an offset is read in PLAINVA_TEST_TZ).

/** The zone every test runs in unless PLAINVA_TEST_TZ names another. Europe/Berlin
 * has summer time, which UTC does not, so day arithmetic that ignores it shows up. */
export const TEST_TIME_ZONE = process.env.PLAINVA_TEST_TZ || "Europe/Berlin";

/** The wall time in TEST_TIME_ZONE every test starts at: a Wednesday in the
 * middle of a month, mid-morning, well away from midnight and from a change of
 * summer time. */
export const TEST_NOW_WALL = process.env.PLAINVA_TEST_NOW || "2026-11-11T10:30:00";

/** Sets the zone of this process. Call it at the top of a test config, before
 * any worker starts, so every worker inherits it. */
export function pinTestTimeZone() {
  process.env.TZ = TEST_TIME_ZONE;
}

/** Offset of `zone` from UTC at the instant `ms`, in milliseconds. */
function zoneOffsetMs(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch milliseconds of a wall time ("2026-11-11T10:30:00") in `zone`. A value
 * with its own offset or `Z` is read as it stands. Independent of process.env.TZ. */
export function wallTimeToEpochMs(wall, zone = TEST_TIME_ZONE) {
  if (/(Z|[+-]\d\d:?\d\d)$/.test(wall)) return Date.parse(wall);
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?)?$/.exec(wall);
  if (!m) throw new Error(`test clock: cannot read the wall time "${wall}"`);
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +frac.padEnd(3, "0"));
  // Two passes settle the offset also next to a change of summer time.
  let ms = naive - zoneOffsetMs(naive, zone);
  ms = naive - zoneOffsetMs(ms, zone);
  return ms;
}

/** TEST_NOW_WALL as epoch milliseconds. */
export const TEST_NOW_MS = wallTimeToEpochMs(TEST_NOW_WALL);

const REAL_DATE = globalThis.Date;

/** The real wall clock, for the rare test that is ABOUT it (it measures the
 * machine, or compares with a file time the operating system wrote). */
export function realDateNow() {
  return REAL_DATE.now();
}

/**
 * Puts the real Date back for the rest of this test file (vitest gives every
 * file its own realm, so the next file starts on the test clock again). Only
 * for a file that is ABOUT the real clock: it compares with times the
 * operating system writes (file mtimes on a real disk), which no test clock
 * moves. Say so at the call.
 */
export function useRealDate() {
  globalThis.Date = REAL_DATE;
}

/**
 * Replaces `Date` in this realm with one that starts at `startMs` and runs on
 * from there with the real clock. Everything else stays real: timers, the
 * monotonic clock, `vi.useFakeTimers()` on top (it restores this one when the
 * test calls `vi.useRealTimers()`). Subclasses of Date keep working.
 * Returns a function that puts the real Date back.
 */
export function installShiftedDate(startMs, realStartMs = REAL_DATE.now()) {
  const Real = REAL_DATE;
  const offset = startMs - realStartMs;
  const now = () => Real.now() + offset;
  function TestDate(...args) {
    if (!new.target) return new Real(now()).toString();
    return Reflect.construct(Real, args.length ? args : [now()], new.target);
  }
  Object.setPrototypeOf(TestDate, Real);
  TestDate.prototype = Real.prototype;
  TestDate.now = now;
  TestDate.parse = Real.parse;
  TestDate.UTC = Real.UTC;
  TestDate.toString = () => Real.toString();
  Object.defineProperty(TestDate, "name", { value: "Date" });
  globalThis.Date = TestDate;
  return () => { globalThis.Date = Real; };
}

/**
 * The page side of the E2E clock, handed to `addInitScript` by the shared
 * `test` of each app's E2E folder (it must stand alone: no closures). The page's
 * Date starts at `testMs` and runs on with the real clock, anchored to the same
 * real instant (`realMs`) as `testNow()` on the runner side, so a reload does
 * not turn the clock back. Only Date moves: timers, requestAnimationFrame,
 * `performance` and event time stamps stay real, so the editor's input handling
 * is what it is outside the tests. A test that calls `page.clock` gets
 * Playwright's own clock instead, on the real Date (`releasePageDate`).
 */
export function installPageDate({ testMs, realMs }) {
  if (globalThis.__plainvaRealDate) return;
  const Real = Date;
  const offset = testMs - realMs;
  const now = () => Real.now() + offset;
  function TestDate(...args) {
    if (!new.target) return new Real(now()).toString();
    return Reflect.construct(Real, args.length ? args : [now()], new.target);
  }
  Object.setPrototypeOf(TestDate, Real);
  TestDate.prototype = Real.prototype;
  TestDate.now = now;
  TestDate.parse = Real.parse;
  TestDate.UTC = Real.UTC;
  TestDate.toString = () => Real.toString();
  Object.defineProperty(TestDate, "name", { value: "Date" });
  Object.defineProperty(globalThis, "__plainvaRealDate", { value: Real, configurable: true });
  globalThis.Date = TestDate;
}

/** Puts the page's real Date back, before Playwright's clock takes over. */
export function releasePageDate() {
  const Real = globalThis.__plainvaRealDate;
  if (!Real) return;
  globalThis.Date = Real;
  delete globalThis.__plainvaRealDate;
}
