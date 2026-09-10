import { describe, expect, it, vi } from "vitest";

/**
 * The native fetch bridge must honour `init.signal` (2026-07-16): every sync
 * target wraps its requests in a timeout AbortController, and ignoring the
 * signal here disabled all of those timeouts on device — one hung native call
 * wedged the SyncWorker until a force-close.
 */
const mocks = vi.hoisted(() => ({
  request: vi.fn<(o: unknown) => Promise<{ status: number; headers: Record<string, string>; bodyBase64: string }>>(),
  allowOrigin: vi.fn(async () => {}),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => mocks,
}));

import { webdavFetch } from "./webdavHttp";

describe("webdavFetch (native bridge)", () => {
  it("resolves a plain response from the plugin", async () => {
    mocks.request.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "text/plain" },
      bodyBase64: btoa("hi"),
    });

    const res = await webdavFetch("https://example.com/x", { method: "GET" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("rejects with AbortError when the signal aborts mid-flight (the plugin call never settles)", async () => {
    mocks.request.mockReturnValueOnce(new Promise(() => {})); // a hung native call
    const controller = new AbortController();

    const pending = webdavFetch("https://example.com/hung", {
      method: "GET",
      signal: controller.signal,
    });
    const observed = pending.catch((e: unknown) => e);
    controller.abort();

    const err = (await observed) as Error;
    expect(err.name).toBe("AbortError");
  });

  it("rejects immediately on an already-aborted signal without calling the plugin", async () => {
    mocks.request.mockClear();
    const controller = new AbortController();
    controller.abort();

    await expect(
      webdavFetch("https://example.com/never", { method: "GET", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not start a native write if cancelled while preparing a Blob", async () => {
    mocks.request.mockClear();
    const controller = new AbortController();
    const blob = new Blob(["upload"]);
    let ready!: (value: ArrayBuffer) => void;
    const read = vi.spyOn(blob, "arrayBuffer").mockReturnValue(new Promise(resolve => { ready = resolve; }));
    try {
      const pending = webdavFetch("https://example.com/upload", { method: "PUT", body: blob, signal: controller.signal }).catch(e => e);
      controller.abort(); ready(new ArrayBuffer(1));
      expect(await pending).toMatchObject({ name: "AbortError" });
      expect(mocks.request).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });

  it("observes an abort that happens as the plugin call is dispatched", async () => {
    const controller = new AbortController();
    mocks.request.mockImplementationOnce(async () => { controller.abort(); return { status: 200, headers: {}, bodyBase64: btoa("late") }; });
    await expect(webdavFetch("https://example.com/race", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("removes the listener on abort and discards a later native failure", async () => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    let fail!: (reason: Error) => void;
    mocks.request.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const pending = webdavFetch("https://example.com/late", { signal: controller.signal }).catch(e => e);
    controller.abort(); expect(await pending).toMatchObject({ name: "AbortError" });
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    fail(new Error("native call eventually failed")); await Promise.resolve();
    removed.mockRestore();
  });

  it("still resolves normally when a signal is present but never aborts", async () => {
    mocks.request.mockResolvedValueOnce({ status: 204, headers: {}, bodyBase64: "" });
    const controller = new AbortController();

    const res = await webdavFetch("https://example.com/ok", {
      method: "DELETE",
      signal: controller.signal,
    });

    expect(res.status).toBe(204);
  });
});
