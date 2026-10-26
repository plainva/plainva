import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsOnlySync } from "../../src/sync/SettingsOnlySync.js";

/**
 * Second review of plan "Verbinden", B3: while files are off for a vault, a
 * device keeps the settings profile moving on its interval - and nothing
 * else - so "off" and "on" reach every device. Runs are serialised; a failed
 * run is tried again on the next tick.
 */
describe("the settings-only sync of a vault whose files are off", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const target = { download: vi.fn(), upload: vi.fn(), pull: vi.fn() } as never;
  const vault = {} as never;

  it("syncs the settings right away and then on every interval, and touches no file", async () => {
    const runner = { run: vi.fn().mockResolvedValue(undefined), guardBeforeCycle: vi.fn().mockResolvedValue(undefined) };
    const sync = new SettingsOnlySync(runner, target, vault, 1000);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.guardBeforeCycle).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.run).toHaveBeenCalledTimes(2);
    sync.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("goes on after a failed run - the next tick delivers what did not get through", async () => {
    const errors: unknown[] = [];
    const runner = { run: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined) };
    const sync = new SettingsOnlySync(runner, target, vault, 1000, (error) => errors.push(error));
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.run).toHaveBeenCalledTimes(2);
    await sync.stopAndDrain();
  });

  it("never runs twice at once: a push waits for the run in flight", async () => {
    let release: () => void = () => {};
    let inFlight = 0;
    let most = 0;
    const runner = {
      run: vi.fn(async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise<void>((resolve) => { release = resolve; });
        inFlight -= 1;
      }),
    };
    const sync = new SettingsOnlySync(runner, target, vault, 60_000);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const push = sync.pushSettingsNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await push;
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
    sync.stop();
  });
});
