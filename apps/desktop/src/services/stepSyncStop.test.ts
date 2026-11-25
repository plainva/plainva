// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";
import { createVaultCallOff } from "@plainva/core";
import { stopSyncForStep, type StepSyncStop } from "./stepSyncStop";
import { awaitVaultTeardown, resetVaultTeardownsForTests } from "./vaultTeardown";

/**
 * A step that stops the sync to work on the vault — the security wizard,
 * locking, restoring or lifting a workspace — waited for the cycle for as long
 * as it ran: with no end where a call hung. Now within the close's deadline;
 * after it the vault is left and opened anew, and the step goes on with the
 * new runtime.
 */

const VAULT = "/vaults/notes";
const messages = () => toastStore.get().map((t) => t.message);

function parts(order: string[], worker: StepSyncStop["worker"]): StepSyncStop {
  const fence = createVaultCallOff();
  return {
    path: VAULT,
    vault: "Notes",
    worker,
    owed: { flush: async () => { order.push(fence.calledOff ? "owed after the call-off" : "owed"); } },
    fence,
    forgetWorker: () => order.push("forget"),
    holdSync: () => order.push("hold"),
    reopen: async () => { order.push(fence.calledOff ? "reopen" : "reopen before the call-off"); },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  resetVaultTeardownsForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  toast.clearAll();
});

describe("a step that stops the sync on the desktop", () => {
  it("goes on with the runtime on screen where the cycle ends in time", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    const worker = { stop: vi.fn(), stopAndDrain: async () => { order.push("drained"); } };
    expect(await stopSyncForStep(parts(order, worker))).toBe("same");
    expect(worker.stop).toHaveBeenCalled();
    expect(order).toEqual(["drained"]);
  });

  it("leaves the vault after 30 s — owed entries first, then the call-off — opens it anew with its sync held, and parks the cycle it left", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    let cycleEnded!: () => void;
    const worker = { stop: vi.fn(), stopAndDrain: () => new Promise<void>((r) => (cycleEnded = r)) };
    const step = parts(order, worker);
    let outcome: string | undefined;
    const stopping = stopSyncForStep(step).then((o) => { outcome = o; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.syncWait", { vault: "Notes" })]);
    await vi.advanceTimersByTimeAsync(24_000);
    // THE DEFECT: the step waited for the cycle for as long as it ran.
    expect(outcome, "within the deadline it waits").toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
    expect(outcome).toBe("renewed");
    expect(messages()).toEqual([i18n.t("closing.syncGaveUp", { vault: "Notes" })]);
    expect(order).toEqual(["owed", "forget", "hold", "reopen"]);
    // The vault's next open waits for the cycle it left (text 7): never two runtimes at one vault.
    let reopenedFree = false;
    const free = awaitVaultTeardown(VAULT).then(() => { reopenedFree = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(reopenedFree).toBe(false);
    cycleEnded();
    await free;
    expect(reopenedFree).toBe(true);
  });

  it("does nothing without a sync", async () => {
    expect.hasAssertions();
    expect(await stopSyncForStep(parts([], null))).toBe("same");
  });
});
