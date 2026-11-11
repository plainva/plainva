import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldFolderVerdict } from "@plainva/ui";
import { askHeldFolder, desktopSyncBranch } from "./services/encryptedRemoteStart";

/**
 * The desktop's start of a vault (R8, third review): nearly every vault takes
 * the plain branch with nothing awaited; only a vault with a fact is held, and
 * its folder is asked in the background - at once, then with backoff,
 * offline-aware, never for a load that was replaced, and never by reloading
 * the vault.
 */
const waiting: HeldFolderVerdict = { kind: "waiting" };
const plain: HeldFolderVerdict = { kind: "plain" };

describe("which sync a desktop vault builds", () => {
  it("a vault without a fact takes the plain branch - no probe, nothing held", () => {
    expect(desktopSyncBranch({ held: false, filesRun: "files", member: false, hasRuntime: false })).toBe("plain");
    expect(desktopSyncBranch({ held: true, filesRun: "files", member: false, hasRuntime: false })).toBe("held");
    // Files off: the settings-only sync looks at the folder once per session itself.
    expect(desktopSyncBranch({ held: true, filesRun: "settingsOnly", member: false, hasRuntime: false })).toBe("settingsOnly");
  });

  it("a member without its keys goes to the workspace branch, files on or off", () => {
    expect(desktopSyncBranch({ held: false, filesRun: "settingsOnly", member: true, hasRuntime: false })).toBe("workspace");
    expect(desktopSyncBranch({ held: false, filesRun: "files", member: true, hasRuntime: false })).toBe("workspace");
    expect(desktopSyncBranch({ held: false, filesRun: "settingsOnly", member: true, hasRuntime: true })).toBe("settingsOnly");
  });
});

describe("asking a held folder", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const noOnline = () => () => undefined;

  it("asks at once, waits calmly with backoff, and starts the sync step on a verdict - once", async () => {
    const answers = [waiting, waiting, plain];
    const decide = vi.fn(async () => answers.shift()!);
    const onStart = vi.fn();
    const onWaiting = vi.fn();
    askHeldFolder({ decide, signal: new AbortController().signal, onWaiting, onHeld: vi.fn(), onStart, isOnline: () => true, whenOnline: noOnline });
    await vi.advanceTimersByTimeAsync(0);
    expect(decide).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(2); // backed off: the next wait is two minutes
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(3);
    expect(onWaiting).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).toHaveBeenCalledTimes(3);
  });

  it("asks again at once when the person says so - also after a verdict that needs them", async () => {
    let answer: HeldFolderVerdict = { kind: "pair-required" };
    const decide = vi.fn(async () => answer);
    const onHeld = vi.fn();
    const onStart = vi.fn();
    const handle = askHeldFolder({ decide, signal: new AbortController().signal, onWaiting: vi.fn(), onHeld, onStart, isOnline: () => true, whenOnline: noOnline });
    await vi.advanceTimersByTimeAsync(0);
    expect(onHeld).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).toHaveBeenCalledTimes(1); // a verdict for the person is not retried by itself
    answer = plain;
    handle.askNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a load that was replaced or a vault that was closed", async () => {
    const decide = vi.fn(async () => plain);
    const abort = new AbortController();
    abort.abort();
    const onStart = vi.fn();
    askHeldFolder({ decide, signal: abort.signal, onWaiting: vi.fn(), onHeld: vi.fn(), onStart, isOnline: () => true, whenOnline: noOnline });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).not.toHaveBeenCalled();
    const live = askHeldFolder({ decide: vi.fn(async () => waiting), signal: new AbortController().signal, onWaiting: vi.fn(), onHeld: vi.fn(), onStart, isOnline: () => true, whenOnline: noOnline });
    live.cancel(); // the teardown
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("waits while offline and asks once the machine is back", async () => {
    let online = false;
    let back: (() => void) | null = null;
    const decide = vi.fn(async () => plain);
    const onStart = vi.fn();
    askHeldFolder({ decide, signal: new AbortController().signal, onWaiting: vi.fn(), onHeld: vi.fn(), onStart, isOnline: () => online, whenOnline: (callback) => { back = callback; return () => { back = null; }; } });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).not.toHaveBeenCalled();
    online = true;
    back!();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
