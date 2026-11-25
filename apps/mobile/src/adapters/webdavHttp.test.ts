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

import { allowHttpOrigin, webdavFetch, webdavFetchCountedIn } from "./webdavHttp";
import { createVaultCallOff } from "@plainva/core";
import { clearDiagnosticsForTests, getDiagnostics } from "@plainva/ui";

describe("webdavFetch (native bridge)", () => {
  it("does not hide a failed origin registration or log its private address", async () => {
    clearDiagnosticsForTests();
    mocks.allowOrigin.mockRejectedValueOnce(new Error("private.server/path"));
    await expect(allowHttpOrigin("https://private.server/path")).rejects.toMatchObject({ code: "HTTP_ORIGIN_BLOCKED" });
    expect(getDiagnostics()).toEqual([{ ts: expect.any(Number), source: "native-http", message: "allow-origin: HTTP_ORIGIN_BLOCKED" }]);
  });
  it("exports a stable TLS cause without the server path, credentials or certificate subject", async () => {
    clearDiagnosticsForTests();
    mocks.request.mockRejectedValueOnce({ code: "TLS_CERTIFICATE_UNTRUSTED", message: "https://user:secret@private.test/vault/family?token=live; CN=Family" });
    await expect(webdavFetch("https://user:secret@private.test/vault/family?token=live", {
      method: "PROPFIND", headers: { Authorization: "Bearer private-token" },
    })).rejects.toMatchObject({ message: "TLS_CERTIFICATE_UNTRUSTED", code: "TLS_CERTIFICATE_UNTRUSTED" });
    expect(getDiagnostics()).toEqual([{ ts: expect.any(Number), source: "native-http", message: "PROPFIND: TLS_CERTIFICATE_UNTRUSTED" }]);
  });
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

  it("counts a request of a vault's sync it gave up waiting for in that runtime, until the native call has ended", async () => {
    expect.hasAssertions();
    // The bridge cannot cancel: after the request's time limit the JS side goes on, the native call runs on.
    let answer!: (value: { status: number; headers: Record<string, string>; bodyBase64: string }) => void;
    mocks.request.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const fence = createVaultCallOff();
    const syncFetch = webdavFetchCountedIn((call) => fence.track(call));
    const controller = new AbortController();
    const pending = syncFetch("https://example.com/Note.md", { method: "PUT", body: "v1", signal: controller.signal }).catch((e: Error) => e.name);
    controller.abort();
    expect(await pending).toBe("AbortError");
    // The runtime is left: the same vault opens again only once that PUT has ended at the provider.
    fence.callOff();
    let ended = false;
    const ending = fence.ended().then(() => { ended = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(ended).toBe(false);
    answer({ status: 201, headers: {}, bodyBase64: "" });
    await ending;
    expect(ended).toBe(true);
  });

  it("counts nothing for a request that was answered", async () => {
    expect.hasAssertions();
    mocks.request.mockResolvedValueOnce({ status: 200, headers: {}, bodyBase64: btoa("ok") });
    const counted = vi.fn();
    const controller = new AbortController();
    const res = await webdavFetchCountedIn(counted)("https://example.com/x", { method: "GET", signal: controller.signal });
    expect(res.status).toBe(200);
    controller.abort();
    expect(counted).not.toHaveBeenCalled();
  });

  it("counts a request of mail, a calendar or a sign-in for no vault's runtime", async () => {
    expect.hasAssertions();
    // A vault runtime that counts its sync's requests is open meanwhile.
    const fence = createVaultCallOff();
    void webdavFetchCountedIn((call) => fence.track(call));
    mocks.request.mockReturnValueOnce(new Promise(() => {}));
    const controller = new AbortController();
    const pending = webdavFetch("https://mail.example.com/inbox", { method: "GET", signal: controller.signal }).catch((e: Error) => e.name);
    controller.abort();
    expect(await pending).toBe("AbortError");
    // THE DEFECT: the open runtime counted it, and opening that vault again waited up to the native limit for mail.
    fence.callOff();
    let ended = false;
    await fence.ended().then(() => { ended = true; });
    expect(ended).toBe(true);
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
    clearDiagnosticsForTests();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    let fail!: (reason: Error) => void;
    mocks.request.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const pending = webdavFetch("https://example.com/late", { signal: controller.signal }).catch(e => e);
    controller.abort(); expect(await pending).toMatchObject({ name: "AbortError" });
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    fail(new Error("native call eventually failed")); await Promise.resolve(); await Promise.resolve();
    expect(getDiagnostics()).toEqual([]);
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
