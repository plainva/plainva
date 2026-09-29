import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileVault } from "../vaultService";
import * as pim from "./pimRuntime";

/**
 * The phone brings the PIM cycle back when it comes back (plan
 * Mobile-PIM-Auffrischung, P1/P2).
 *
 * The finding this pins: a task created in Google Tasks took very long to reach
 * Plainva and its reminder never arrived at all. A WebView runs no timers in
 * the background, so the worker's two-minute interval is dead for as long as
 * the app is away — and the reminder run reads the task DATABASE, which the
 * mirror only fills at the END of a cycle. No cycle, no mirror, no reminder.
 *
 * Two things therefore have to happen on return, and both are asserted here:
 * the cycle is asked for, and the reminders are replanned even when that cycle
 * turns out to have nothing new (a quiet cycle fires no `onDataChanged`).
 *
 * The runtime lives in pimRuntime.ts, apart from the sign-ins, provider clients
 * and diagnostics of pimService (Befunde 2026-09-24, Z2): importing pimService
 * loaded the whole shared UI package, 23 to 45 seconds before the first test,
 * and under a loaded commit hook it ran past a 60-second hook timeout. This
 * file now loads the runtime, the core's worker and cache (both faked below)
 * and nothing else.
 */

const { triggered, started, scopeState } = vi.hoisted(() => ({ triggered: { count: 0 }, started: vi.fn(), scopeState: vi.fn(async () => {}) }));

const { rescheduleReminders } = vi.hoisted(() => ({ rescheduleReminders: vi.fn() }));
vi.mock("../reminderScheduler", () => ({ rescheduleReminders }));

// The task-sync runtime hangs off the same boot and reaches for the vault's
// files; it has nothing to do with the trigger under test.
vi.mock("./taskSyncRuntime", () => ({
  startTaskSyncRuntime: vi.fn(),
  stopTaskSyncRuntime: vi.fn(),
  runMobileTaskSync: vi.fn(),
}));

// The runtime takes exactly two things from the core, so the fakes ARE the
// module: loading the real core only to replace these two would cost seconds.
vi.mock("@plainva/core", () => {
  class FakeCache {
    listAccounts = async () => [{ id: "a1", enabled: true }];
    setScopeState = scopeState;
  }
  class FakeWorker {
    start() { started(); }
    stop() {}
    triggerImmediate() {
      triggered.count += 1;
      return Promise.resolve();
    }
  }
  return { PimCacheRepository: FakeCache, PimWorker: FakeWorker };
});

const vault = { vaultId: "v1", db: {} } as unknown as MobileVault;

// What pimService hands in. The fake worker runs no cycle, so none of it is called.
const wiring: pim.PimRuntimeWiring = {
  buildTarget: async () => null,
  accountAuthRevision: async () => undefined,
  parkedMessage: "sign-in required",
  onCycle: () => {},
};

beforeAll(async () => {
  // Booted ONCE: the other tests start from this runtime, and the throttle
  // reset seam is what lets each of them start from a known throttle state.
  await pim.startPimRuntime(vault, wiring);
});

beforeEach(() => {
  triggered.count = 0;
  started.mockClear();
  scopeState.mockClear();
  rescheduleReminders.mockClear();
  pim.resetPimForegroundThrottle();
});

describe("pimForegroundSync", () => {
  it("does not revive a vault closed while clearing its previous failure", async () => {
    scopeState.mockImplementationOnce(async () => { pim.stopPim(); throw new Error("database closed"); });
    await pim.restartPimAccountAfterLogin("v1", "a1");
    expect(started).not.toHaveBeenCalled();
    expect(triggered.count).toBe(0);
    await pim.startPimRuntime(vault, wiring);
  });
  it("reconnect clears the captured vault's calendar failure and starts its worker", async () => {
    await pim.restartPimAccountAfterLogin("v1", "a1");
    expect(scopeState).toHaveBeenCalledWith("a1", "account", { lastError: null });
    expect(started).toHaveBeenCalledTimes(1);
    expect(triggered.count).toBe(1);
  });

  it("a reconnect for another vault cannot wake or clear this runtime", async () => {
    await pim.restartPimAccountAfterLogin("other-vault", "a1");
    expect(scopeState).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(triggered.count).toBe(0);
  });

  it("an unconfirmed failure reset does not report a resumed worker", async () => {
    scopeState.mockRejectedValueOnce(new Error("cache unavailable"));
    await expect(pim.restartPimAccountAfterLogin("v1", "a1")).rejects.toThrow("cache unavailable");
    expect(started).not.toHaveBeenCalled();
    expect(triggered.count).toBe(0);
  });
  it("asks for a cycle", () => {
    pim.pimForegroundSync(1_000_000);
    expect(triggered.count).toBe(1);
    // The reminder replanning that rides along is asserted in
    // pimWiring.test.ts, at source level: the scheduler is reached through a
    // LAZY import, and a mocked module only invokes on its first dynamic
    // import — so a runtime assertion here stays green with the call deleted.
    // Found by the red counter-check, which is what it is for.
  });

  it("throttles a burst of returns to one cycle", () => {
    const t0 = 1_000_000;
    pim.pimForegroundSync(t0);
    pim.pimForegroundSync(t0 + 1_000);
    pim.pimForegroundSync(t0 + 59_999);
    expect(triggered.count).toBe(1);
  });

  it("lets the next return through once the window has passed", () => {
    const t0 = 1_000_000;
    pim.pimForegroundSync(t0);
    pim.pimForegroundSync(t0 + 60_000);
    expect(triggered.count).toBe(2);
  });

  it("an explicit 'refresh now' ignores the throttle", () => {
    const t0 = 1_000_000;
    pim.pimForegroundSync(t0);
    // The person in front of the phone just said "now" — a silent no-op is
    // exactly what the D9 finding was.
    pim.pimSyncNow();
    pim.pimSyncNow();
    expect(triggered.count).toBe(3);
  });

  it("does nothing without a running PIM runtime", async () => {
    // The state the app boots into, and the one a vault switch passes through.
    pim.stopPim();
    pim.pimForegroundSync(2_000_000);
    expect(triggered.count).toBe(0);
    expect(rescheduleReminders).not.toHaveBeenCalled();
    await pim.startPimRuntime(vault, wiring); // leave the module as the other tests expect it
  });
});
