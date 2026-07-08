// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestSaveFlush } from "./saveFlush";

describe("requestSaveFlush", () => {
  // jsdom shares one window per file: echo listeners must not leak into the
  // next test, or they ack flushes they do not own.
  let cleanup: Array<() => void> = [];
  const listen = (handler: (e: Event) => void) => {
    window.addEventListener("plainva-flush-pending-save", handler);
    cleanup.push(() => window.removeEventListener("plainva-flush-pending-save", handler));
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    vi.useRealTimers();
  });

  it("resolves when an editor acks the flush for the same path", async () => {
    listen((e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      window.dispatchEvent(new CustomEvent("plainva-pending-save-flushed", { detail: { path } }));
    });
    const resolved = vi.fn();
    requestSaveFlush("a.md").then(resolved);
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toHaveBeenCalled();
  });

  it("ignores acks for other paths and resolves on timeout instead", async () => {
    listen(() => {
      window.dispatchEvent(new CustomEvent("plainva-pending-save-flushed", { detail: { path: "other.md" } }));
    });
    const resolved = vi.fn();
    requestSaveFlush("mine.md", 500).then(resolved);
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toHaveBeenCalled();
  });

  it("resolves after the timeout when no editor answers", async () => {
    const resolved = vi.fn();
    requestSaveFlush("closed.md", 300).then(resolved);
    await vi.advanceTimersByTimeAsync(299);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toHaveBeenCalled();
  });
});
