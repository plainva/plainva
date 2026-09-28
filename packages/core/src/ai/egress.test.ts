import { describe, expect, it } from "vitest";
import { appendTurn, startConversation } from "./conversation.js";
import { failureFromHttp, fetchProviderJson, providerErrorMessage, runModelCall, type AiEgress, type EgressChunk } from "./egress.js";
import type { HttpRequestSpec } from "./providers.js";
import { BUILTIN_ENDPOINTS } from "./providers.js";
import type { StreamEvent } from "./streams.js";

/** A native egress stand-in: replays chunks and records what it was asked to send. */
function fakeEgress(chunks: EgressChunk[]): AiEgress & { sent: HttpRequestSpec[]; cancelled: string[] } {
  const sent: HttpRequestSpec[] = [];
  const cancelled: string[] = [];
  return {
    sent,
    cancelled,
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of chunks) onChunk(chunk);
    },
    async cancel(id) {
      cancelled.push(id);
    },
    async setKey() {},
    async hasKey() {
      return true;
    },
    async deleteKey() {},
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
}

const anthropic = BUILTIN_ENDPOINTS.find((e) => e.id === "anthropic")!;
const conversation = appendTurn(startConversation("c", "system", []), { role: "user", parts: [{ type: "text", text: "Hello" }], at: "2026-09-24T10:00:00Z" });
const sse = (...messages: Array<[string, unknown]>) => messages.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

describe("runModelCall", () => {
  it("decodes the stream chunk by chunk, whatever the chunk borders", async () => {
    const transcript = sse(
      ["message_start", { type: "message_start", message: { usage: { input_tokens: 12 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi there" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }],
      ["message_stop", { type: "message_stop" }],
    );
    const chunks: EgressChunk[] = [{ type: "open", status: 200 }];
    for (let i = 0; i < transcript.length; i += 5) chunks.push({ type: "data", text: transcript.slice(i, i + 5) });
    chunks.push({ type: "done" });
    const events: StreamEvent[] = [];
    const egress = fakeEgress(chunks);
    const result = await runModelCall(egress, anthropic, { model: "m", conversation, tools: [], maxOutputTokens: 100 }, (e) => events.push(e), { requestId: "r1" });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Hi there");
    expect(result).toEqual({ stop: "end", usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect(egress.sent[0]!.method).toBe("POST");
  });

  it("names failures in terms the interface can act on", async () => {
    const cases: Array<[EgressChunk, string]> = [
      [{ type: "httpError", status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }, "invalid_key"],
      [{ type: "httpError", status: 429, body: "" }, "rate_limited"],
      [{ type: "httpError", status: 529, body: "" }, "overloaded"],
      [{ type: "httpError", status: 404, body: '{"error":{"message":"model: nope"}}' }, "not_found"],
      [{ type: "httpError", status: 400, body: '{"error":{"message":"prompt is too long: 250000 tokens"}}' }, "context_too_long"],
      [{ type: "failed", code: "no_key", message: "" }, "no_key"],
      [{ type: "failed", code: "unknown_endpoint", message: "" }, "unknown_endpoint"],
      [{ type: "failed", code: "idle_timeout", message: "" }, "stream_broken"],
      [{ type: "failed", code: "network", message: "dns" }, "offline"],
    ];
    for (const [chunk, kind] of cases) {
      const result = await runModelCall(fakeEgress([chunk]), anthropic, { model: "m", conversation, tools: [], maxOutputTokens: 10 }, () => {}, { requestId: "r" });
      expect(result.failure?.kind, JSON.stringify(chunk)).toBe(kind);
    }
  });

  it("keeps the pause a rate limit asks for, in seconds or as a date", () => {
    expect(failureFromHttp(429, "", "7")).toEqual({ kind: "rate_limited", status: 429, retryAfterSeconds: 7 });
    expect(failureFromHttp(429, "", "0.2")).toEqual({ kind: "rate_limited", status: 429, retryAfterSeconds: 1 });
    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    const fromDate = failureFromHttp(429, "", inAMinute);
    expect(fromDate.kind === "rate_limited" && fromDate.retryAfterSeconds).toBeGreaterThanOrEqual(58);
    expect(failureFromHttp(429, "", "")).toEqual({ kind: "rate_limited", status: 429 });
    expect(failureFromHttp(429, "", null)).toEqual({ kind: "rate_limited", status: 429 });
  });

  it("asks the egress to stop when the signal aborts, and reports the stop", async () => {
    const controller = new AbortController();
    const egress = fakeEgress([{ type: "open", status: 200 }]);
    const original = egress.send;
    egress.send = async (id, spec, onChunk) => {
      await original(id, spec, onChunk);
      controller.abort();
      onChunk({ type: "cancelled" });
    };
    const result = await runModelCall(egress, anthropic, { model: "m", conversation, tools: [], maxOutputTokens: 10 }, () => {}, { requestId: "stop-me", signal: controller.signal });
    expect(result.stop).toBe("cancelled");
    expect(egress.cancelled).toEqual(["stop-me"]);
  });
});

describe("provider error text", () => {
  it("keeps the provider's message, not the JSON around it", () => {
    expect(providerErrorMessage('{"error":{"type":"x","message":"Overloaded"}}')).toBe("Overloaded");
    expect(providerErrorMessage('{"error":"quota"}')).toBe("quota");
    expect(providerErrorMessage("plain text")).toBe("plain text");
    expect(failureFromHttp(400, '{"error":{"message":"bad field"}}')).toEqual({ kind: "refused_by_provider", status: 400, message: "bad field" });
  });
});

describe("fetchProviderJson", () => {
  it("joins the chunks of one JSON answer", async () => {
    const egress = fakeEgress([{ type: "open", status: 200 }, { type: "data", text: '{"data":[{"id"' }, { type: "data", text: ':"m1"}]}' }, { type: "done" }]);
    const spec: HttpRequestSpec = { endpointId: "openai", url: "https://api.openai.com/v1/models", method: "GET", headers: {}, auth: null, stream: false };
    expect(await fetchProviderJson(egress, spec, "t")).toEqual({ ok: true, json: { data: [{ id: "m1" }] } });
    expect(await fetchProviderJson(fakeEgress([{ type: "httpError", status: 401, body: "" }]), spec, "t")).toEqual({ ok: false, failure: { kind: "invalid_key", status: 401 } });
  });
});
