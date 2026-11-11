import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_NOW_MS, TEST_TIME_ZONE, installShiftedDate, realDateNow, wallTimeToEpochMs } from "../../../scripts/test-clock.mjs";

/**
 * The test clock every suite runs on (stability plan R9, scripts/test-clock.mjs).
 * These pin what the other tests lean on without saying so.
 */
describe("the test clock", () => {
  afterEach(() => vi.useRealTimers());

  it("starts every file at TEST_NOW, in TEST_TIME_ZONE, and runs on from there", async () => {
    expect(process.env.TZ).toBe(TEST_TIME_ZONE);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(TEST_TIME_ZONE);
    const now = Date.now();
    // The file started at TEST_NOW; this test runs seconds later, never before it.
    expect(now).toBeGreaterThanOrEqual(TEST_NOW_MS);
    expect(now - TEST_NOW_MS).toBeLessThan(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now()).toBeGreaterThan(now);
    // The real clock stays reachable for the rare test that is about it, and runs at the same pace.
    expect(Math.abs((realDateNow() - Date.now()) - (realDateNow() - Date.now()))).toBeLessThan(1000);
  });

  it("is a Date in every way a caller can tell", () => {
    const d = new Date();
    expect(d).toBeInstanceOf(Date);
    expect(typeof Date()).toBe("string");
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date(2026, 0, 2).getDate()).toBe(2);
    expect(Date.UTC(2026, 0, 1)).toBe(1767225600000);
    expect(Date.parse("2026-01-01T00:00:00Z")).toBe(1767225600000);
    class Stamped extends Date {
      stamp() { return this.getTime(); }
    }
    const s = new Stamped(5);
    expect(s).toBeInstanceOf(Stamped);
    expect(s).toBeInstanceOf(Date);
    expect(s.stamp()).toBe(5);
    expect(new Stamped().getTime()).toBeGreaterThanOrEqual(TEST_NOW_MS);
  });

  it("lies under vi.useFakeTimers and comes back after vi.useRealTimers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-02-02T02:02:00Z"));
    expect(new Date().toISOString()).toBe("2020-02-02T02:02:00.000Z");
    vi.useRealTimers();
    expect(Date.now()).toBeGreaterThanOrEqual(TEST_NOW_MS);
    vi.setSystemTime(new Date("2021-03-03T03:03:00Z"));
    expect(new Date().toISOString()).toBe("2021-03-03T03:03:00.000Z");
    vi.useRealTimers();
    expect(Date.now()).toBeGreaterThanOrEqual(TEST_NOW_MS);
  });

  it("reads a wall time in the zone it names, also next to a change of summer time", () => {
    expect(wallTimeToEpochMs("2026-11-11T10:30:00", "Europe/Berlin")).toBe(Date.parse("2026-11-11T09:30:00Z"));
    expect(wallTimeToEpochMs("2026-07-01T10:30:00", "Europe/Berlin")).toBe(Date.parse("2026-07-01T08:30:00Z"));
    // The night summer time ends in Berlin (03:00 CEST -> 02:00 CET): 04:00 is CET.
    expect(wallTimeToEpochMs("2026-10-25T04:00:00", "Europe/Berlin")).toBe(Date.parse("2026-10-25T03:00:00Z"));
    expect(wallTimeToEpochMs("2026-03-08T12:00:00", "America/New_York")).toBe(Date.parse("2026-03-08T16:00:00Z"));
    expect(wallTimeToEpochMs("2026-11-11T23:59:30", "UTC")).toBe(Date.parse("2026-11-11T23:59:30Z"));
    expect(wallTimeToEpochMs("2026-11-11T10:30:00Z", "Asia/Tokyo")).toBe(Date.parse("2026-11-11T10:30:00Z"));
    expect(() => wallTimeToEpochMs("yesterday")).toThrow(/cannot read/);
  });

  it("can start anywhere and give the real Date back", () => {
    const Before = globalThis.Date;
    const restore = installShiftedDate(Date.parse("2030-01-01T00:00:00Z"));
    try {
      expect(new Date().getUTCFullYear()).toBe(2030);
    } finally {
      restore();
      globalThis.Date = Before;
    }
    expect(Date.now()).toBeGreaterThanOrEqual(TEST_NOW_MS);
  });
});
