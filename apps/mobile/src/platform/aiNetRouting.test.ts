import { describe, expect, it, vi } from "vitest";
import type { EgressChunk, HttpRequestSpec } from "@plainva/core";

const calls: Array<{ plugin: string; method: string; url?: string; requestId?: string }> = [];

/** A native plugin as the egress sees it; request "r3" stays open until it is cancelled. */
function fakePlugin(name: string) {
  const open = new Map<string, (chunk: EgressChunk | null) => void>();
  return {
    request: (options: { url: string; requestId: string }, callback: (chunk: EgressChunk | null) => void) => {
      calls.push({ plugin: name, method: "request", url: options.url, requestId: options.requestId });
      callback({ type: "open", status: 200 });
      if (options.requestId === "r3") open.set(options.requestId, callback);
      else callback({ type: "done" });
      return Promise.resolve("cb");
    },
    cancel: (options: { requestId: string }) => {
      calls.push({ plugin: name, method: "cancel", requestId: options.requestId });
      open.get(options.requestId)?.({ type: "cancelled" });
      open.delete(options.requestId);
      return Promise.resolve({ cancelled: true });
    },
  };
}

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => fakePlugin(name),
}));

const { createMobileAiEgress } = await import("./aiNet");

const spec = (url: string, endpointId: string): HttpRequestSpec => ({ endpointId, url, method: "POST", headers: {}, body: { prompt: "Hi" }, auth: null, stream: true });

/** Plan KI-Harness P2c: the system's own model never goes through the network egress. */
describe("the phone's AI egress", () => {
  it("hands requests for the system's model to its plugin and every other to the network egress", async () => {
    const egress = createMobileAiEgress(() => ({ title: "", message: "", confirm: "", cancel: "" }));
    const chunks: EgressChunk[] = [];
    await egress.send("r1", spec("platform://apple/generate", "apple"), (c) => chunks.push(c));
    await egress.send("r2", spec("https://api.example.com/v1/chat/completions", "custom-1"), () => undefined);
    expect(calls.filter((c) => c.method === "request").map((c) => [c.plugin, c.requestId])).toEqual([
      ["PlatformModel", "r1"],
      ["AiNet", "r2"],
    ]);
    expect(chunks.map((c) => c.type)).toEqual(["open", "done"]);
  });

  it("cancels where the request went", async () => {
    const egress = createMobileAiEgress(() => ({ title: "", message: "", confirm: "", cancel: "" }));
    const pending = egress.send("r3", spec("platform://gemini-nano/generate", "gemini-nano"), () => undefined);
    await egress.cancel("r3");
    await egress.cancel("r4");
    await pending;
    expect(calls.filter((c) => c.method === "cancel").map((c) => [c.plugin, c.requestId])).toEqual([
      ["PlatformModel", "r3"],
      ["AiNet", "r4"],
    ]);
  });
});
