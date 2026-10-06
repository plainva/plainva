import { describe, expect, it, vi } from "vitest";

const calls: Array<{ plugin: string; method: string; url?: string; requestId?: string }> = [];
const pending = new Map<string, (result: unknown) => void>();

vi.mock("@capacitor/core", () => ({
  registerPlugin: (name: string) => ({
    // "w2" stays open until it is cancelled; "w3" is a platform without the plugin.
    fetchPage: (options: { url: string; requestId: string }) => {
      calls.push({ plugin: name, method: "fetchPage", url: options.url, requestId: options.requestId });
      if (options.requestId === "w3") return Promise.reject(new Error("not implemented on web"));
      if (options.requestId === "w2") return new Promise((resolve) => pending.set(options.requestId, resolve));
      return Promise.resolve({ kind: "page", url: options.url, status: 200, contentType: "text/html", body: "<p>x</p>", truncated: false });
    },
    cancel: (options: { requestId: string }) => {
      calls.push({ plugin: name, method: "cancel", requestId: options.requestId });
      pending.get(options.requestId)?.({ kind: "failed", code: "cancelled" });
      pending.delete(options.requestId);
      return Promise.resolve({ cancelled: true });
    },
  }),
}));

const { createMobileWebFetcher } = await import("./aiWeb");

/** Plan KI-Harness P4: a page is fetched by the plugin of its own, stopped through it, and never by the web view itself. */
describe("the phone's page fetch", () => {
  it("asks its own plugin, stops through its cancel, and fetches nothing where the plugin is missing", async () => {
    const fetcher = createMobileWebFetcher();
    expect(await fetcher.fetch("https://example.org/", { requestId: "w1" })).toMatchObject({ kind: "page", url: "https://example.org/" });

    const stop = new AbortController();
    const waiting = fetcher.fetch("https://example.org/slow", { requestId: "w2", signal: stop.signal });
    stop.abort();
    expect(await waiting).toEqual({ kind: "failed", code: "cancelled" });
    // Stopped before it started: the plugin is not asked.
    expect(await fetcher.fetch("https://example.org/", { requestId: "w4", signal: stop.signal })).toEqual({ kind: "failed", code: "cancelled" });

    expect(await fetcher.fetch("https://example.org/", { requestId: "w3" })).toEqual({ kind: "failed", code: "error" });
    expect(calls.map((c) => [c.plugin, c.method, c.requestId])).toEqual([
      ["AiWeb", "fetchPage", "w1"],
      ["AiWeb", "fetchPage", "w2"],
      ["AiWeb", "cancel", "w2"],
      ["AiWeb", "fetchPage", "w3"],
    ]);
  });
});
