import type { ReasoningPart, ToolCallPart } from "./conversation.js";
import type { ProviderApi } from "./providers.js";

/**
 * Stream decoders (ADR 0017): the native egress hands over server-sent events
 * as they arrive; these turn each provider's dialect into one set of events.
 * Tool calls and reasoning are emitted COMPLETE (arguments parsed, signatures
 * attached), so the orchestrator appends them to the conversation as they
 * are — append-only (ADR 0018).
 */

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; part: ReasoningPart }
  | { type: "tool_call"; call: ToolCallPart }
  /**
   * Token counts, normalised across providers: `inputTokens` is the input
   * NOT served from the provider's cache, `cacheReadTokens` the part that
   * was. Anthropic reports it that way; OpenAI and Gemini count cached tokens
   * inside their total, so their decoders subtract them — otherwise a cost
   * estimate would count cached input twice.
   */
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: "stop"; reason: StopReason }
  | { type: "error"; message: string; code?: string };

/** A total that includes cached tokens, without them. */
function uncached(total: number | undefined, cached: number | undefined): number | undefined {
  return total === undefined ? undefined : Math.max(0, total - (cached ?? 0));
}

export interface SseMessage {
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser: feed it chunks in any split, it returns the complete
 * messages. Comments (`:` lines) and retry fields are ignored.
 */
export function createSseParser(): { push(chunk: string): SseMessage[]; finish(): SseMessage[] } {
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  const take = (line: string, out: SseMessage[]) => {
    if (line === "") {
      if (data.length) out.push({ event, data: data.join("\n") });
      event = undefined;
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      const out: SseMessage[] = [];
      let index: number;
      while ((index = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(buffer[index] === "\r" && buffer[index + 1] === "\n" ? index + 2 : index + 1);
        take(line, out);
      }
      return out;
    },
    finish() {
      const out: SseMessage[] = [];
      if (buffer) take(buffer, out);
      buffer = "";
      take("", out);
      return out;
    },
  };
}

export interface StreamDecoder {
  push(message: SseMessage): StreamEvent[];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseArgs(text: string): unknown {
  if (text.trim() === "") return {};
  const parsed = parseJson(text);
  return parsed === undefined ? { _unparsed: text } : parsed;
}

// ---------------------------------------------------------------- Anthropic

function anthropicDecoder(): StreamDecoder {
  const blocks = new Map<number, { type: string; id?: string; name?: string; json: string; thinking: string; signature?: string; data?: string }>();
  const stopReasons: Record<string, StopReason> = { end_turn: "end", stop_sequence: "end", tool_use: "tool_use", max_tokens: "max_tokens", refusal: "refusal" };
  return {
    push({ data }) {
      const msg = parseJson(data) as Record<string, any> | undefined;
      if (!msg) return [];
      switch (msg.type) {
        case "message_start": {
          const u = msg.message?.usage ?? {};
          return [{ type: "usage", inputTokens: u.input_tokens, cacheReadTokens: u.cache_read_input_tokens, cacheWriteTokens: u.cache_creation_input_tokens }];
        }
        case "content_block_start": {
          const b = msg.content_block ?? {};
          blocks.set(msg.index, { type: b.type, id: b.id, name: b.name, json: "", thinking: b.thinking ?? "", signature: b.signature, data: b.data });
          return b.type === "text" && b.text ? [{ type: "text", text: b.text }] : [];
        }
        case "content_block_delta": {
          const block = blocks.get(msg.index);
          const d = msg.delta ?? {};
          if (d.type === "text_delta") return [{ type: "text", text: d.text }];
          if (!block) return [];
          if (d.type === "input_json_delta") block.json += d.partial_json ?? "";
          else if (d.type === "thinking_delta") block.thinking += d.thinking ?? "";
          else if (d.type === "signature_delta") block.signature = (block.signature ?? "") + (d.signature ?? "");
          return [];
        }
        case "content_block_stop": {
          const block = blocks.get(msg.index);
          blocks.delete(msg.index);
          if (!block) return [];
          if (block.type === "tool_use") {
            return [{ type: "tool_call", call: { type: "tool_call", id: block.id ?? "", name: block.name ?? "", args: parseArgs(block.json) } }];
          }
          if (block.type === "thinking") {
            return [{ type: "reasoning", part: { type: "reasoning", provider: "anthropic", data: { type: "thinking", thinking: block.thinking, signature: block.signature ?? "" } } }];
          }
          if (block.type === "redacted_thinking") {
            return [{ type: "reasoning", part: { type: "reasoning", provider: "anthropic", data: { type: "redacted_thinking", data: block.data ?? "" } } }];
          }
          return [];
        }
        case "message_delta": {
          const out: StreamEvent[] = [];
          if (msg.usage) out.push({ type: "usage", outputTokens: msg.usage.output_tokens });
          if (msg.delta?.stop_reason) out.push({ type: "stop", reason: stopReasons[msg.delta.stop_reason] ?? "other" });
          return out;
        }
        case "error":
          return [{ type: "error", message: msg.error?.message ?? "provider error", code: msg.error?.type }];
        default:
          return [];
      }
    },
  };
}

// ---------------------------------------------------------- OpenAI Responses

function openAiResponsesDecoder(): StreamDecoder {
  return {
    push({ data }) {
      const msg = parseJson(data) as Record<string, any> | undefined;
      if (!msg) return [];
      switch (msg.type) {
        case "response.output_text.delta":
          return msg.delta ? [{ type: "text", text: msg.delta }] : [];
        case "response.output_item.done": {
          const item = msg.item ?? {};
          if (item.type === "function_call") return [{ type: "tool_call", call: { type: "tool_call", id: item.call_id ?? item.id ?? "", name: item.name ?? "", args: parseArgs(item.arguments ?? "") } }];
          if (item.type === "reasoning") return [{ type: "reasoning", part: { type: "reasoning", provider: "openai", data: item } }];
          return [];
        }
        case "response.completed":
        case "response.incomplete": {
          const r = msg.response ?? {};
          const out: StreamEvent[] = [];
          const u = r.usage;
          if (u) out.push({ type: "usage", inputTokens: uncached(u.input_tokens, u.input_tokens_details?.cached_tokens), outputTokens: u.output_tokens, cacheReadTokens: u.input_tokens_details?.cached_tokens });
          const toolUse = Array.isArray(r.output) && r.output.some((o: { type?: string }) => o.type === "function_call");
          const reason: StopReason =
            msg.type === "response.incomplete" ? (r.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "other") : toolUse ? "tool_use" : "end";
          out.push({ type: "stop", reason });
          return out;
        }
        case "response.refusal.done":
          return [{ type: "stop", reason: "refusal" }];
        case "response.failed":
          return [{ type: "error", message: msg.response?.error?.message ?? "provider error", code: msg.response?.error?.code }];
        case "error":
          return [{ type: "error", message: msg.message ?? msg.error?.message ?? "provider error", code: msg.code ?? msg.error?.code }];
        default:
          return [];
      }
    },
  };
}

// -------------------------------------------------------------- OpenAI Chat

function openAiChatDecoder(): StreamDecoder {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const stopReasons: Record<string, StopReason> = { stop: "end", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "refusal" };
  const flushCalls = (): StreamEvent[] => {
    const out: StreamEvent[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({ type: "tool_call" as const, call: { type: "tool_call" as const, id: c.id, name: c.name, args: parseArgs(c.args) } }));
    calls.clear();
    return out;
  };
  return {
    push({ data }) {
      if (data.trim() === "[DONE]") return flushCalls();
      const msg = parseJson(data) as Record<string, any> | undefined;
      if (!msg) return [];
      if (msg.error) return [{ type: "error", message: msg.error.message ?? "provider error", code: msg.error.code ?? msg.error.type }];
      const out: StreamEvent[] = [];
      for (const choice of msg.choices ?? []) {
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content) out.push({ type: "text", text: delta.content });
        for (const tc of delta.tool_calls ?? []) {
          const index = typeof tc.index === "number" ? tc.index : calls.size;
          const current = calls.get(index) ?? { id: "", name: "", args: "" };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name += tc.function.name;
          if (tc.function?.arguments) current.args += tc.function.arguments;
          calls.set(index, current);
        }
        if (choice.finish_reason) {
          out.push(...flushCalls());
          out.push({ type: "stop", reason: stopReasons[choice.finish_reason] ?? "other" });
        }
      }
      if (msg.usage) {
        const cached = msg.usage.prompt_tokens_details?.cached_tokens;
        out.push({ type: "usage", inputTokens: uncached(msg.usage.prompt_tokens, cached), outputTokens: msg.usage.completion_tokens, cacheReadTokens: cached });
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------- Gemini

function geminiDecoder(): StreamDecoder {
  let callCount = 0;
  const stopReasons: Record<string, StopReason> = { STOP: "end", MAX_TOKENS: "max_tokens", SAFETY: "refusal", RECITATION: "refusal", PROHIBITED_CONTENT: "refusal", BLOCKLIST: "refusal", SPII: "refusal" };
  return {
    push({ data }) {
      const msg = parseJson(data) as Record<string, any> | undefined;
      if (!msg) return [];
      if (msg.error) return [{ type: "error", message: msg.error.message ?? "provider error", code: String(msg.error.status ?? msg.error.code ?? "") }];
      const out: StreamEvent[] = [];
      let sawCall = false;
      for (const candidate of msg.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall) {
            sawCall = true;
            callCount++;
            const { functionCall, ...rest } = part;
            const signature = rest.thoughtSignature ? { thoughtSignature: rest.thoughtSignature } : undefined;
            out.push({
              type: "tool_call",
              call: {
                type: "tool_call",
                id: functionCall.id ?? `gemini-call-${callCount}`,
                name: functionCall.name ?? "",
                args: functionCall.args ?? {},
                ...(signature ? { providerData: { provider: "gemini", data: signature } } : {}),
              },
            });
          } else if (typeof part.text === "string" && part.text && !part.thought) {
            out.push({ type: "text", text: part.text });
          }
        }
        if (candidate.finishReason) out.push({ type: "stop", reason: sawCall ? "tool_use" : (stopReasons[candidate.finishReason] ?? "other") });
      }
      const u = msg.usageMetadata;
      if (u) out.push({ type: "usage", inputTokens: uncached(u.promptTokenCount, u.cachedContentTokenCount), outputTokens: u.candidatesTokenCount, cacheReadTokens: u.cachedContentTokenCount });
      return out;
    },
  };
}

export function createStreamDecoder(api: ProviderApi): StreamDecoder {
  switch (api) {
    case "anthropic-messages":
      return anthropicDecoder();
    case "openai-responses":
      return openAiResponsesDecoder();
    case "openai-chat":
      return openAiChatDecoder();
    case "gemini":
      return geminiDecoder();
  }
}
