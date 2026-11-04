import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  classifyWorkspaceSyncFailure, createPersonalWorkspaceBootstrap, EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore, MemoryWorkspaceStateStore, personalWorkspaceRuntime,
  WorkspaceProtocolError, workspaceSyncRetryDelay,
  type IVaultAdapter, type PersonalWorkspaceRuntime, type WorkspaceRuntimeMeta,
} from "../src/index.js";
import { syncHttpError } from "../src/sync/errorKind.js";

let runtime: PersonalWorkspaceRuntime;
beforeAll(async () => { runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({
  ownerDisplayName: "Test owner", deviceDisplayName: "Test device", platform: "desktop", minimumClientVersion: "0.8.2",
})); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture() {
  const state = new MemoryWorkspaceStateStore();
  // The scheduling contract must not invoke filesystem operations itself.
  const vault = new Proxy({} as IVaultAdapter, { get: () => { throw new Error("Unexpected filesystem access in scheduler"); } });
  const worker = new EncryptedWorkspaceWorker(new FakeWorkspaceObjectStore(), state, vault, runtime, { intervalMs: 1000, random: () => 1 });
  const statuses = vi.fn();
  worker.onStatusChange = statuses;
  return { state, worker, statuses };
}

describe("encrypted workspace scheduling", () => {
  it("backs off offline attempts, preserves queued edits, then resets after success", async () => {
    vi.useFakeTimers();
    const { worker, state, statuses } = fixture();
    await state.enqueue("write", "local.md");
    const cycle = vi.spyOn(worker, "runCycle").mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("network timeout")).mockResolvedValue(undefined);
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toHaveBeenLastCalledWith("retrying", "offline", undefined, Date.now() + 2000, "transient");
    worker.triggerImmediate();
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses).toHaveBeenLastCalledWith("retrying", "network timeout", undefined, Date.now() + 4000, "transient");
    expect((await state.listQueue())[0]).toMatchObject({ path: "local.md", retryCount: 0, lastError: null });
    await vi.advanceTimersByTimeAsync(4000);
    expect(statuses).toHaveBeenLastCalledWith("idle");
    await vi.advanceTimersByTimeAsync(1000);
    expect(cycle).toHaveBeenCalledTimes(4);
    await worker.stopAndDrain();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [new Error("HTTP 401 Unauthorized"), "authentication"],
    [new WorkspaceProtocolError("integrity", "initial policy is missing or changed"), "integrity"],
    [new Error("TLS_HOSTNAME_MISMATCH"), "fatal"],
  ] as const)("pauses %s until an explicit retry", async (error, kind) => {
    vi.useFakeTimers();
    const { worker, statuses } = fixture();
    const cycle = vi.spyOn(worker, "runCycle").mockRejectedValueOnce(error).mockResolvedValue(undefined);
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toHaveBeenLastCalledWith("error", error.message, undefined, undefined, kind);
    worker.triggerImmediate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cycle).toHaveBeenCalledTimes(1);
    await worker.runNow();
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(statuses).toHaveBeenLastCalledWith("idle");
    await worker.stopAndDrain();
  });

  it("says once that its first cycle went through, not after a failed one (3.119)", async () => {
    // The phone holds back announcing files the index finds as new until the
    // first sync has looked; only the plain worker said so, so with an
    // encrypted workspace a file put beside the app reached the queue only at
    // the next start.
    vi.useFakeTimers();
    const { worker } = fixture();
    const first = vi.fn();
    worker.onFirstCycleComplete = first;
    vi.spyOn(worker, "runCycle").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(first).not.toHaveBeenCalled();
    await worker.runNow();
    expect(first).toHaveBeenCalledTimes(1);
    await worker.runNow();
    expect(first).toHaveBeenCalledTimes(1);
    await worker.stopAndDrain();
  });

  it("queues one manual retry behind a failing active cycle without overlap", async () => {
    vi.useFakeTimers();
    const { worker, statuses } = fixture();
    let reject!: (reason: Error) => void;
    const cycle = vi.spyOn(worker, "runCycle").mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    worker.start();
    const first = worker.runNow();
    const second = worker.runNow();
    expect(cycle).toHaveBeenCalledTimes(1);
    reject(new Error("401 unauthorized"));
    await Promise.all([first, second]);
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(statuses).toHaveBeenLastCalledWith("idle");
    await worker.stopAndDrain();
  });

  it("does not persist an abort, count a queue failure, or schedule after stopping", async () => {
    vi.useFakeTimers();
    const { worker, state, statuses } = fixture();
    const save = vi.spyOn(state, "saveMeta");
    vi.spyOn(worker, "runCycle").mockImplementation((signal) => new Promise((_, reject) => {
      signal!.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
    }));
    worker.start();
    await worker.stopAndDrain();
    expect(save).not.toHaveBeenCalled();
    expect(statuses.mock.calls.map(call => call[0])).toEqual(["syncing"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps persisted failure metadata separate from the fresh worker's retry counter", async () => {
    vi.useFakeTimers();
    const { worker, state } = fixture();
    await state.saveMeta({ workspaceId: runtime.workspaceId, lastError: null } as WorkspaceRuntimeMeta);
    vi.spyOn(worker, "runCycle").mockRejectedValue(new Error("network unavailable"));
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect((await state.loadMeta())?.lastSyncFailure).toMatchObject({ kind: "transient", message: "network unavailable", at: Date.now() });
    await worker.stopAndDrain();
    const next = new EncryptedWorkspaceWorker(new FakeWorkspaceObjectStore(), state, {} as IVaultAdapter, runtime, { intervalMs: 1000, random: () => 1 });
    const nextStatus = vi.fn(); next.onStatusChange = nextStatus;
    vi.spyOn(next, "runCycle").mockRejectedValue(new Error("offline"));
    next.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(nextStatus).toHaveBeenLastCalledWith("retrying", "offline", undefined, Date.now() + 2000, "transient");
    await next.stopAndDrain();
  });
});

describe("encrypted workspace failure policy", () => {
  it("keeps HTTP Retry-After through provider errors and bounds both delay sources", () => {
    const error = syncHttpError("WebDAV GET failed: 429 Too Many Requests", new Response(null, { status: 429, headers: { "Retry-After": "90" } }));
    expect(classifyWorkspaceSyncFailure(error)).toBe("transient");
    expect(workspaceSyncRetryDelay(error, 1, 15_000, 0, 0)).toBe(90_000);
    expect(workspaceSyncRetryDelay(new Error("offline"), 100, 15_000, 0, 1)).toBe(300_000);
    expect(workspaceSyncRetryDelay(new Error("offline"), 1, 15_000, 0, 0)).toBe(15_000);
    expect(workspaceSyncRetryDelay({ retryAfterMs: 86_400_000 }, 1, 15_000, 0, 1)).toBe(3_600_000);
  });
  it("does not suggest account reauthentication for a refused workspace capability", () => {
    expect(classifyWorkspaceSyncFailure(new WorkspaceProtocolError("authorization", "operation capability is not granted"))).toBe("integrity");
    expect(classifyWorkspaceSyncFailure(new Error("HTTP 403 forbidden"))).toBe("fatal");
  });
});
