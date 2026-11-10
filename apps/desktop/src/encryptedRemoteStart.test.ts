import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedRemoteGate } from "@plainva/ui";
import { desktopSyncBranch, recheckEncryptedRemote } from "./services/encryptedRemoteStart";

/**
 * The desktop's start of a vault on a folder that may hold an encrypted
 * workspace (R8): which sync is built at all, and how a held folder is asked
 * again - only the probe, never the vault, with backoff, offline-aware, and
 * never for a load that was replaced.
 */
const held: EncryptedRemoteGate = { kind: "unconfirmed", why: "known", probeError: null, mayDismiss: false };
const plain: EncryptedRemoteGate = { kind: "plain", probeError: null };

describe("which sync a desktop vault builds", () => {
  it("builds nothing plain while the gate holds - not the files, not the settings-only sync", () => {
    for (const gate of [held, { kind: "pair-required" } as const, { kind: "left" } as const]) {
      expect(desktopSyncBranch({ gate, filesRun: "files", member: false, hasRuntime: false })).toBe("held");
      expect(desktopSyncBranch({ gate, filesRun: "settingsOnly", member: false, hasRuntime: false })).toBe("held");
    }
    expect(desktopSyncBranch({ gate: plain, filesRun: "settingsOnly", member: false, hasRuntime: false })).toBe("settingsOnly");
    expect(desktopSyncBranch({ gate: plain, filesRun: "files", member: false, hasRuntime: false })).toBe("plain");
  });

  it("a member without its keys goes to the workspace branch, files on or off", () => {
    expect(desktopSyncBranch({ gate: null, filesRun: "settingsOnly", member: true, hasRuntime: false })).toBe("workspace");
    expect(desktopSyncBranch({ gate: null, filesRun: "files", member: true, hasRuntime: false })).toBe("workspace");
    expect(desktopSyncBranch({ gate: null, filesRun: "settingsOnly", member: true, hasRuntime: true })).toBe("settingsOnly");
  });
});

describe("asking a held folder again", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks the probe with backoff and hands on the first verdict once", async () => {
    const answers = [held, held, plain];
    const decide = vi.fn(async () => answers.shift()!);
    const onVerdict = vi.fn();
    const onStillHeld = vi.fn();
    recheckEncryptedRemote({ decide, signal: new AbortController().signal, onStillHeld, onVerdict, isOnline: () => true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(1); // backed off: the second wait is two minutes
    await vi.advanceTimersByTimeAsync(60_000);
    expect(decide).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(decide).toHaveBeenCalledTimes(3);
    expect(onStillHeld).toHaveBeenCalledTimes(2);
    expect(onVerdict).toHaveBeenCalledWith(plain);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).toHaveBeenCalledTimes(3);
  });

  it("does nothing for a load that was replaced or a vault that was closed", async () => {
    const decide = vi.fn(async () => plain);
    const abort = new AbortController();
    const onVerdict = vi.fn();
    const handle = recheckEncryptedRemote({ decide, signal: abort.signal, onStillHeld: vi.fn(), onVerdict, isOnline: () => true });
    abort.abort();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).not.toHaveBeenCalled();
    handle.cancel();
    const second = recheckEncryptedRemote({ decide, signal: new AbortController().signal, onStillHeld: vi.fn(), onVerdict, isOnline: () => true });
    second.cancel(); // the teardown
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("waits while offline and asks once the machine is back", async () => {
    let online = false;
    let back: (() => void) | null = null;
    const decide = vi.fn(async () => plain);
    const onVerdict = vi.fn();
    recheckEncryptedRemote({ decide, signal: new AbortController().signal, onStillHeld: vi.fn(), onVerdict, isOnline: () => online, whenOnline: (callback) => { back = callback; return () => { back = null; }; } });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(decide).not.toHaveBeenCalled();
    online = true;
    back!();
    await vi.advanceTimersByTimeAsync(0);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(onVerdict).toHaveBeenCalled();
  });
});
