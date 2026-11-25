import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVaultCallOff } from "@plainva/core";
import { LoadStarts } from "./loadStarts";
import { awaitVaultTeardown, resetVaultTeardownsForTests } from "./vaultTeardown";

/**
 * Open-items plan 3.120: a vault load that is called off (another vault is
 * opened while the first index run still writes) stopped at its next look at
 * the signal and returned - and left the PIM worker it had started, and the
 * sync worker it started after the index run, running for a vault nobody had
 * open. Opening that vault again put a second sync worker on the same queue.
 */

function worker() {
  let running = false;
  let drained!: () => void;
  const draining = new Promise<void>((resolve) => { drained = resolve; });
  return {
    start: vi.fn(() => { running = true; }),
    stop: vi.fn(() => { running = false; }),
    stopAndDrain: vi.fn(() => { running = false; return draining; }),
    running: () => running,
    finish: () => drained(),
  };
}

describe("what a vault load started", () => {
  beforeEach(() => resetVaultTeardownsForTests());

  it("starts nothing once the load is called off", () => {
    const leaving = new AbortController();
    const starts = new LoadStarts("/vault/a", leaving.signal);
    const w = worker();
    leaving.abort();
    expect(starts.start(w, () => w.start())).toBe(false);
    expect(w.start).not.toHaveBeenCalled();
  });

  it("is stopped and drained when the load is called off, and the next open waits for it", async () => {
    const leaving = new AbortController();
    const starts = new LoadStarts("/vault/a", leaving.signal);
    const pim = worker();
    const sync = worker();
    starts.start(pim, () => pim.start());
    starts.start(sync, () => sync.start());
    leaving.abort();

    const drain = starts.abandon();
    // The clocks stop at once, before anything is awaited.
    expect(pim.stop).toHaveBeenCalled();
    expect(sync.stop).toHaveBeenCalled();
    expect(sync.running()).toBe(false);

    let reopened = false;
    const reopen = awaitVaultTeardown("/vault/a").then(() => { reopened = true; });
    await Promise.resolve();
    expect(reopened).toBe(false);
    sync.finish();
    pim.finish();
    await drain;
    await reopen;
    expect(reopened).toBe(true);
  });

  it("leaves alone what a load that went through handed to its vault", () => {
    const starts = new LoadStarts("/vault/a", new AbortController().signal);
    const w = worker();
    starts.start(w, () => w.start());
    starts.settle();
    void starts.abandon();
    expect(w.stop).not.toHaveBeenCalled();
  });
});

describe("the vault load hands what it started to LoadStarts (wiring, read from the source)", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "contexts/VaultContext.tsx"), "utf8");
  const load = source.slice(source.indexOf("const loadVault = async ("), source.indexOf("const teardownVault = async () => {"));

  it("starts every worker through it", () => {
    expect(load).toContain("loadStarts.start(pimRuntime, () => pimRuntime.worker.start())");
    // The sync workers ask first whether a step holds the vault's sync (`stopSyncForStep`).
    expect(load).toContain("loadStarts.start(fileWorker, () => { if (syncHeldRef.current !== path) fileWorker.start(); })");
    expect(load).toContain("loadStarts.start(worker, () => { if (syncHeldRef.current !== path) worker.start(); })");
    // No worker of the load is started past it.
    expect(load).not.toMatch(/^\s*(pimRuntime\.worker|syncWorker|worker|settingsOnlyRef\.current)\.start\(\);/m);
  });

  it("gives everything back at every exit of a load that is called off or fails", () => {
    // Each `if (currentAbortSignal.aborted)` that ends the load after the
    // first worker may have started abandons what was started.
    const exits = load.match(/if \(currentAbortSignal\.aborted\) \{\s*void loadStarts\.abandon\(\);\s*return;/g) ?? [];
    expect(exits.length).toBe(2);
    expect(load).not.toMatch(/if \(currentAbortSignal\.aborted\) return;\s*\n\s*\/\/ Preserve the explicit locked status/);
    expect(load).toContain("loadStarts.settle();");
  });
});

describe("a called-off load and its runtime (never two runtimes at one vault)", () => {
  beforeEach(() => resetVaultTeardownsForTests());

  const openCall = (fence: ReturnType<typeof createVaultCallOff>) => {
    let answer!: () => void;
    const storage = fence.storage({ writeTextFile: () => new Promise<void>((r) => (answer = r)) } as never) as unknown as { writeTextFile(): Promise<void> };
    const write = storage.writeTextFile();
    return { answer: () => answer(), write };
  };

  it("calls the runtime off, and the next open of the vault waits until none of its calls is open", async () => {
    const abort = new AbortController();
    const starts = new LoadStarts("/vaults/notes", abort.signal);
    const fence = createVaultCallOff();
    starts.fence(fence);
    const call = openCall(fence);
    abort.abort();
    void starts.abandon();
    let reopened = false;
    const reopening = awaitVaultTeardown("/vaults/notes").then(() => { reopened = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(fence.calledOff, "called off").toBe(true);
    expect(reopened, "waits for the open call").toBe(false);
    call.answer();
    await call.write;
    await reopening;
    expect(reopened).toBe(true);
  });

  it("a worker started only after the load was called off is stopped, drained and parked with the runtime called off", async () => {
    const abort = new AbortController();
    const starts = new LoadStarts("/vaults/notes", abort.signal);
    const fence = createVaultCallOff();
    starts.fence(fence);
    abort.abort();
    let drained!: () => void;
    const worker = { stop: vi.fn(), stopAndDrain: () => new Promise<void>((r) => (drained = r)) };
    starts.late(worker);
    expect(worker.stop).toHaveBeenCalled();
    let reopened = false;
    const reopening = awaitVaultTeardown("/vaults/notes").then(() => { reopened = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(reopened, "waits for the late worker's drain").toBe(false);
    drained();
    await reopening;
    expect(fence.calledOff).toBe(true);
  });

  it("gives what the runtime owes its sync queue its last attempt before it calls the runtime off", async () => {
    expect.hasAssertions();
    const abort = new AbortController();
    const starts = new LoadStarts("/vaults/notes", abort.signal);
    const fence = createVaultCallOff();
    starts.fence(fence);
    const order: string[] = [];
    starts.owes({ flush: async () => { order.push(fence.calledOff ? "flush after the call-off" : "flush"); } });
    const worker = { stop: vi.fn(), stopAndDrain: async () => { order.push("drain"); } };
    starts.adopt(worker);
    abort.abort();
    await starts.abandon();
    expect(order).toEqual(["drain", "flush"]);
    expect(fence.calledOff).toBe(true);
  });

  it("a fence that comes after the load was called off is called off at once", () => {
    const abort = new AbortController();
    abort.abort();
    const starts = new LoadStarts("/vaults/notes", abort.signal);
    const fence = createVaultCallOff();
    starts.fence(fence);
    expect(fence.calledOff).toBe(true);
  });
});

