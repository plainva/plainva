import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebFetchResult } from "@plainva/core";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { createDesktopWebFetcher } = await import("../services/ai/desktopAiWeb");

/** The desktop's page fetch (plan KI-Harness P4): one native command, stopped through the list a model call is stopped through. */
describe("the desktop's page fetch", () => {
  beforeEach(() => invokeMock.mockReset());

  it("asks the native command and hands back what it answers", async () => {
    const page: WebFetchResult = { kind: "page", url: "https://example.org/", status: 200, contentType: "text/html", body: "<p>x</p>", truncated: false };
    invokeMock.mockResolvedValueOnce(page);
    expect(await createDesktopWebFetcher().fetch("https://example.org/", { requestId: "w1" })).toBe(page);
    expect(invokeMock.mock.calls).toEqual([["ai_web_fetch", { url: "https://example.org/", requestId: "w1" }]]);
  });

  it("stops a running fetch when the run is stopped, and does not start one that was stopped before", async () => {
    let answer: (result: WebFetchResult) => void = () => {};
    invokeMock.mockImplementation((command: string) => (command === "ai_web_fetch" ? new Promise<WebFetchResult>((resolve) => (answer = resolve)) : Promise.resolve(true)));
    const stop = new AbortController();
    const pending = createDesktopWebFetcher().fetch("https://example.org/slow", { requestId: "w2", signal: stop.signal });
    stop.abort();
    expect(invokeMock.mock.calls[1]).toEqual(["ai_http_cancel", { requestId: "w2" }]);
    answer({ kind: "failed", code: "cancelled" });
    expect(await pending).toEqual({ kind: "failed", code: "cancelled" });

    invokeMock.mockClear();
    expect(await createDesktopWebFetcher().fetch("https://example.org/", { requestId: "w3", signal: stop.signal })).toEqual({ kind: "failed", code: "cancelled" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
