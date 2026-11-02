import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(load).toContain("loadStarts.start(fileWorker, () => fileWorker.start())");
    expect(load).toContain("loadStarts.start(worker, () => worker.start())");
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
