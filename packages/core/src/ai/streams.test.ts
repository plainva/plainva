import { describe, expect, it } from "vitest";
import { createSseParser, createStreamDecoder, type StreamEvent } from "./streams.js";
import type { ProviderApi } from "./providers.js";

/** Runs a raw SSE transcript through the parser in awkward chunks, then the decoder. */
function decode(api: ProviderApi, transcript: string, chunk = 7): StreamEvent[] {
  const parser = createSseParser();
  const decoder = createStreamDecoder(api);
  const events: StreamEvent[] = [];
  for (let i = 0; i < transcript.length; i += chunk) {
    for (const message of parser.push(transcript.slice(i, i + chunk))) events.push(...decoder.push(message));
  }
  for (const message of parser.finish()) events.push(...decoder.push(message));
  return events;
}

const sse = (...messages: Array<[string | null, unknown]>) =>
  messages.map(([event, data]) => `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`).join("");

const text = (events: StreamEvent[]) => events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");

describe("SSE parser", () => {
  it("joins multi-line data, keeps event names, skips comments, accepts CRLF", () => {
    const parser = createSseParser();
    const out = [...parser.push(": ping\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\ndata: x"), ...parser.finish()];
    expect(out).toEqual([{ event: "a", data: "one\ntwo" }, { event: undefined, data: "x" }]);
  });
});

describe("stream decoders", () => {
  it("Anthropic: text, thinking with signature, a tool call from partial JSON, usage and stop", () => {
    const events = decode(
      "anthropic-messages",
      sse(
        ["message_start", { type: "message_start", message: { usage: { input_tokens: 120, cache_read_input_tokens: 100 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Search first." } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me " } }],
        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "look." } }],
        ["content_block_stop", { type: "content_block_stop", index: 1 }],
        ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "search_vault", input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"query": "North' } }],
        ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'wind"}' } }],
        ["content_block_stop", { type: "content_block_stop", index: 2 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }],
        ["message_stop", { type: "message_stop" }],
      ),
    );
    expect(text(events)).toBe("Let me look.");
    expect(events).toContainEqual({ type: "reasoning", part: { type: "reasoning", provider: "anthropic", data: { type: "thinking", thinking: "Search first.", signature: "abc" } } });
    expect(events).toContainEqual({ type: "tool_call", call: { type: "tool_call", id: "toolu_1", name: "search_vault", args: { query: "Northwind" } } });
    expect(events).toContainEqual({ type: "usage", inputTokens: 120, cacheReadTokens: 100, cacheWriteTokens: undefined });
    expect(events.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
  });

  it("OpenAI Responses: text deltas, a function call, encrypted reasoning, usage", () => {
    const events = decode(
      "openai-responses",
      sse(
        [null, { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1", encrypted_content: "enc" } }],
        [null, { type: "response.output_text.delta", delta: "The deadline " }],
        [null, { type: "response.output_text.delta", delta: "is near." }],
        [null, { type: "response.output_item.done", item: { type: "function_call", call_id: "call_9", name: "read_note", arguments: '{"path":"a.md"}' } }],
        [null, { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } }, output: [{ type: "function_call" }] } }],
      ),
    );
    expect(text(events)).toBe("The deadline is near.");
    expect(events).toContainEqual({ type: "reasoning", part: { type: "reasoning", provider: "openai", data: { type: "reasoning", id: "rs_1", encrypted_content: "enc" } } });
    expect(events).toContainEqual({ type: "tool_call", call: { type: "tool_call", id: "call_9", name: "read_note", args: { path: "a.md" } } });
    expect(events.slice(-2)).toEqual([{ type: "usage", inputTokens: 6, outputTokens: 5, cacheReadTokens: 4 }, { type: "stop", reason: "tool_use" }]);
  });

  it("OpenAI Chat (compatible servers): tool call fragments by index, [DONE]", () => {
    const events = decode(
      "openai-chat",
      sse(
        [null, { choices: [{ delta: { content: "Hi" } }] }],
        [null, { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_", arguments: '{"ra' } }] } }] }],
        [null, { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "tasks", arguments: 'nge":"today"}' } }] } }] }],
        [null, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }],
        [null, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }],
        [null, "[DONE]"],
      ),
    );
    expect(events).toEqual([
      { type: "text", text: "Hi" },
      { type: "tool_call", call: { type: "tool_call", id: "c1", name: "get_tasks", args: { range: "today" } } },
      { type: "stop", reason: "tool_use" },
      { type: "usage", inputTokens: 7, outputTokens: 3, cacheReadTokens: undefined },
    ]);
  });

  it("Gemini: text without thought summaries, a call with its thought signature", () => {
    const events = decode(
      "gemini",
      sse(
        [null, { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Checking " }] } }] }],
        [null, { candidates: [{ content: { parts: [{ functionCall: { name: "search_vault", args: { query: "x" } }, thoughtSignature: "sig1" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 } }],
      ),
    );
    expect(text(events)).toBe("Checking ");
    expect(events).toContainEqual({ type: "tool_call", call: { type: "tool_call", id: "gemini-call-1", name: "search_vault", args: { query: "x" }, providerData: { provider: "gemini", data: { thoughtSignature: "sig1" } } } });
    expect(events).toContainEqual({ type: "stop", reason: "tool_use" });
  });

  it("reports provider errors as events, not exceptions", () => {
    expect(decode("anthropic-messages", sse(["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]))).toEqual([{ type: "error", message: "Overloaded", code: "overloaded_error" }]);
    expect(decode("openai-chat", sse([null, { error: { message: "bad key", code: "invalid_api_key" } }]))).toEqual([{ type: "error", message: "bad key", code: "invalid_api_key" }]);
    expect(decode("gemini", sse([null, "not json"]))).toEqual([]);
  });

  it("keeps unparseable tool arguments visible instead of dropping them", () => {
    const events = decode("openai-chat", sse([null, { choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "read_note", arguments: "{broken" } }] }, finish_reason: "tool_calls" }] }]));
    expect(events[0]).toEqual({ type: "tool_call", call: { type: "tool_call", id: "c", name: "read_note", args: { _unparsed: "{broken" } } });
  });
});
