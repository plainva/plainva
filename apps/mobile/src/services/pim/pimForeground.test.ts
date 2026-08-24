import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileVault } from "../vaultService";

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
 */

const { triggered } = vi.hoisted(() => ({ triggered: { count: 0 } }));

const { rescheduleReminders } = vi.hoisted(() => ({ rescheduleReminders: vi.fn() }));
vi.mock("../reminderScheduler", () => ({ rescheduleReminders }));

// The task-sync runtime hangs off the same boot and reaches for the vault's
// files; it has nothing to do with the trigger under test.
vi.mock("./taskSyncRuntime", () => ({
  startTaskSyncRuntime: vi.fn(),
  stopTaskSyncRuntime: vi.fn(),
  runMobileTaskSync: vi.fn(),
}));

vi.mock("@plainva/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/core")>();
  class FakeCache {
    listAccounts = async () => [{ id: "a1", enabled: true }];
  }
  class FakeWorker {
    start() {}
    stop() {}
    triggerImmediate() {
      triggered.count += 1;
      return Promise.resolve();
    }
  }
  return { ...actual, PimCacheRepository: FakeCache, PimWorker: FakeWorker };
});

const vault = { vaultId: "v1", db: {} } as unknown as MobileVault;

let pim: typeof import("./pimService");

beforeAll(async () => {
  // Booted ONCE: this module graph is large, and re-importing it per test is
  // what the throttle reset seam exists to avoid.
  pim = await import("./pimService");
  await pim.startPim(vault);
  // Generous on purpose: importing this module graph costs seconds on a loaded
  // machine, and the default hook timeout is not about that.
}, 60_000);

beforeEach(() => {
  triggered.count = 0;
  rescheduleReminders.mockClear();
  pim.resetPimForegroundThrottle();
});

describe("pimForegroundSync", () => {
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
    await pim.startPim(vault); // leave the module as the other tests expect it
  });
});
