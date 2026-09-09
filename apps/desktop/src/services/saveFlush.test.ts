// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestSaveFlush, type SaveFlushRequest } from "./saveFlush";
import { resetPendingWritesForTests, trackPendingWrite } from "./pendingWrites";
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("requestSaveFlush", () => {
  let cleanup: Array<() => void> = [];
  function listen(handler: (request: SaveFlushRequest) => void) {
    const receive = (event: Event) => handler((event as CustomEvent<SaveFlushRequest>).detail);
    window.addEventListener("plainva-flush-pending-save", receive);
    cleanup.push(() => window.removeEventListener("plainva-flush-pending-save", receive));
  }
  beforeEach(() => { vi.useFakeTimers(); resetPendingWritesForTests(); });
  afterEach(() => { cleanup.forEach((fn) => fn()); cleanup = []; vi.useRealTimers(); });

  it("waits beyond the former timeout for the actual editor write", async () => {
    const gate = deferred();
    listen((request) => request.waitUntil(gate.promise));
    const completed = vi.fn();
    const flush = requestSaveFlush("a.md").then(completed);
    await vi.advanceTimersByTimeAsync(5000);
    expect(completed).not.toHaveBeenCalled();
    gate.resolve();
    await flush;
    expect(completed).toHaveBeenCalledOnce();
  });
  it("rejects a failed save even if an old path-only acknowledgement arrives", async () => {
    listen((request) => {
      request.waitUntil(Promise.reject(new Error("disk full")));
      window.dispatchEvent(new CustomEvent("plainva-pending-save-flushed", { detail: { path: request.path } }));
    });
    await expect(requestSaveFlush("a.md")).rejects.toThrow("disk full");
  });
  it("waits every matching pane before returning a failure", async () => {
    const gate = deferred();
    listen((request) => request.waitUntil(Promise.reject(new Error("first failed"))));
    listen((request) => request.waitUntil(gate.promise));
    const settled = vi.fn();
    const flush = requestSaveFlush("a.md").catch((error) => { settled(); return error; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).not.toHaveBeenCalled();
    gate.resolve();
    expect(await flush).toMatchObject({ message: "first failed" });
  });
  it("finishes immediately when there is no open buffer or pending write", async () => {
    await expect(requestSaveFlush("closed.md")).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits a write started by an already unmounted editor", async () => {
    const gate = deferred();
    const write = trackPendingWrite("vault A", "a.md", gate.promise).catch(() => {});
    const done = vi.fn();
    const flush = requestSaveFlush("a.md", "vault A").catch((error) => { done(); return error; });
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).not.toHaveBeenCalled();
    gate.reject(new Error("unmounted write failed"));
    expect(await flush).toMatchObject({ message: "unmounted write failed" });
    await write;
  });
  it("keeps two requests independent without a shared path-only acknowledgement", async () => {
    const first = deferred(), second = deferred();
    let count = 0;
    listen((request) => request.waitUntil(count++ === 0 ? first.promise : second.promise));
    const one = requestSaveFlush("a.md"), completed = vi.fn();
    const two = requestSaveFlush("a.md").then(completed);
    first.resolve();
    await one;
    expect(completed).not.toHaveBeenCalled();
    second.resolve(); await two;
  });
  it("does not wait for another vault's identical note path", async () => {
    const gate = deferred();
    const write = trackPendingWrite("vault B", "same.md", gate.promise);
    await requestSaveFlush("same.md", "vault A");
    gate.resolve(); await write;
  });
});
