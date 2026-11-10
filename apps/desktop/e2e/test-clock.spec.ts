import { test, expect, testNow } from './fixtures/clockedTest';
import { TEST_NOW_MS, TEST_TIME_ZONE, realDateNow } from '../../../scripts/test-clock.mjs';

/**
 * The fixed clock and zone every spec runs on (stability plan R9): the page
 * starts at TEST_NOW in TEST_TIME_ZONE, and the runner side's testNow() is the
 * same moment, so a date a test computes is the date the app shows.
 */
test('the page runs on the test clock and zone, and testNow() agrees with it', async ({ page }) => {
  await page.goto('/');
  const seen = await page.evaluate(() => ({ now: Date.now(), zone: new Intl.DateTimeFormat().resolvedOptions().timeZone }));
  expect(seen.zone).toBe(TEST_TIME_ZONE);
  expect(seen.now).toBeGreaterThanOrEqual(TEST_NOW_MS);
  expect(seen.now - TEST_NOW_MS).toBeLessThan(60_000);
  expect(Math.abs(testNow().getTime() - seen.now)).toBeLessThan(5_000);
  // The runner computes in the same zone the page shows.
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(TEST_TIME_ZONE);
});

test('a test about one moment still sets it on top of the default', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-03-29T01:59:00'));
  await page.goto('/');
  expect(await page.evaluate(() => new Date().toISOString())).toBe(new Date('2026-03-29T01:59:00').toISOString());
});

test.describe('a test about the real clock', () => {
  test.use({ testClock: 'real' });
  test('runs on it when it says so', async ({ page }) => {
    await page.goto('/');
    const pageNow = await page.evaluate(() => Date.now());
    expect(Math.abs(pageNow - realDateNow())).toBeLessThan(5_000);
    expect(() => testNow()).toThrow(/fixed clock/);
  });
});
