import type { Conversation, Part, Turn } from "./conversation.js";
import { toolInputJsonSchema, type ToolManifest } from "./tools.js";

/**
 * Provider request codecs (ADR 0016): own thin adapters, no provider SDK.
 *
 * They turn a conversation into an HTTP request SPECIFICATION. The WebView
 * never holds a provider key, so the spec says where the key belongs
 * (`auth`) and the native egress (`ai_http` on the desktop, `AiNet` on the
 * phone) inserts it, checks the recipient against its allowlist and streams
 * the answer. The conformance suite (providers.test.ts) pins every rule the
 * plan names: append-only prefixes, a stable tool list, no forced tool
 * choice, no provider-side storage where it can be switched off, the model
 * string exactly as chosen, nothing but the endpoint as recipient.
 */

export type ProviderApi = "anthropic-messages" | "openai-responses" | "openai-chat" | "gemini";

export interface ProviderEndpoint {
  /** Stable id: "anthropic", "openai", "gemini", "openrouter", "ollama", "lmstudio", or a user endpoint id. */
  id: string;
  api: ProviderApi;
  /** Origin plus path prefix, without a trailing slash (e.g. https://api.anthropic.com/v1). */
  baseUrl: string;
  /** Local servers may run without a key. */
  needsKey: boolean;
  /**
   * The official OpenAI API: `store: false` and in-memory prompt-cache
   * retention are sent. Other OpenAI-compatible servers may reject unknown
   * fields, so they get the plain protocol.
   */
  officialOpenAi?: boolean;
}

/** Where the native egress puts the key. The WebView never sees its value. */
export type KeySlot = { header: string; scheme?: "Bearer" } | null;

export interface HttpRequestSpec {
  endpointId: string;
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Record<string, unknown>;
  auth: KeySlot;
  /** The response is a server-sent event stream. */
  stream: true;
}

export interface ModelRequest {
  model: string;
  conversation: Conversation;
  /** Manifests of `conversation.tools`, in that order. */
  tools: readonly ToolManifest[];
  maxOutputTokens: number;
  /** Mark the stable prefix for provider-side prompt caching. */
  cache?: boolean;
}

export const BUILTIN_ENDPOINTS: readonly ProviderEndpoint[] = [
  { id: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  { id: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1", needsKey: true, officialOpenAi: true },
  { id: "gemini", api: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", needsKey: true },
  { id: "openrouter", api: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "ollama", api: "openai-chat", baseUrl: "http://localhost:11434/v1", needsKey: false },
  { id: "lmstudio", api: "openai-chat", baseUrl: "http://localhost:1234/v1", needsKey: false },
];

function checkTools(request: ModelRequest): void {
  const names = request.tools.map((t) => t.name);
  if (names.length !== request.conversation.tools.length || names.some((n, i) => n !== request.conversation.tools[i])) {
    throw new Error("the tool list is fixed per conversation");
  }
}

function jsonArgs(args: unknown): string {
  return JSON.stringify(args ?? {});
}

// ---------------------------------------------------------------- Anthropic

function anthropicPart(part: Part, turn: Turn): Record<string, unknown> | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool_call":
      return { type: "tool_use", id: part.id, name: part.name, input: part.args ?? {} };
    case "tool_result":
      return { type: "tool_result", tool_use_id: part.callId, content: part.content, ...(part.isError ? { is_error: true } : {}) };
    case "reasoning":
      // Thinking blocks go back verbatim, and only to the provider that wrote them.
      return part.provider === "anthropic" && turn.provider === "anthropic" ? (part.data as Record<string, unknown>) : null;
  }
}

function buildAnthropic(endpoint: ProviderEndpoint, request: ModelRequest): HttpRequestSpec {
  const messages = request.conversation.turns.map((turn) => ({
    role: turn.role,
    content: turn.parts.map((p) => anthropicPart(p, turn)).filter((p): p is Record<string, unknown> => p !== null),
  }));
  const tools = request.tools.map((tool, i) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toolInputJsonSchema(tool),
    ...(request.cache && i === request.tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
  const system = [{ type: "text", text: request.conversation.system, ...(request.cache ? { cache_control: { type: "ephemeral" } } : {}) }];
  return {
    endpointId: endpoint.id,
    url: `${endpoint.baseUrl}/messages`,
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: { model: request.model, max_tokens: request.maxOutputTokens, system, messages, ...(tools.length ? { tools } : {}), stream: true },
    auth: endpoint.needsKey ? { header: "x-api-key" } : null,
    stream: true,
  };
}

// ---------------------------------------------------------- OpenAI Responses

function buildOpenAiResponses(endpoint: ProviderEndpoint, request: ModelRequest): HttpRequestSpec {
  const input: Record<string, unknown>[] = [];
  for (const turn of request.conversation.turns) {
    const text = turn.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
    for (const part of turn.parts) {
      if (part.type === "reasoning" && part.provider === "openai" && turn.provider === "openai") input.push(part.data as Record<string, unknown>);
    }
    if (text.length) {
      input.push({
        role: turn.role,
        content: text.map((t) => ({ type: turn.role === "user" ? "input_text" : "output_text", text: t })),
      });
    }
    for (const part of turn.parts) {
      if (part.type === "tool_call") input.push({ type: "function_call", call_id: part.id, name: part.name, arguments: jsonArgs(part.args) });
      if (part.type === "tool_result") input.push({ type: "function_call_output", call_id: part.callId, output: part.content });
    }
  }
  const tools = request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: toolInputJsonSchema(tool), strict: false }));
  return {
    endpointId: endpoint.id,
    url: `${endpoint.baseUrl}/responses`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      model: request.model,
      instructions: request.conversation.system,
      input,
      ...(tools.length ? { tools } : {}),
      max_output_tokens: request.maxOutputTokens,
      stream: true,
      // Nothing kept on the provider's side (30 days otherwise); reasoning
      // travels back encrypted instead of by server-side reference.
      store: false,
      include: ["reasoning.encrypted_content"],
      ...(endpoint.officialOpenAi && request.cache ? { prompt_cache_retention: "in_memory" } : {}),
    },
    auth: endpoint.needsKey ? { header: "authorization", scheme: "Bearer" } : null,
    stream: true,
  };
}

// ------------------------------------------------ OpenAI Chat (compatible)

function buildOpenAiChat(endpoint: ProviderEndpoint, request: ModelRequest): HttpRequestSpec {
  const messages: Record<string, unknown>[] = [{ role: "system", content: request.conversation.system }];
  for (const turn of request.conversation.turns) {
    const text = turn.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n");
    const calls = turn.parts.filter((p) => p.type === "tool_call");
    if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: (c as { id: string }).id, type: "function", function: { name: (c as { name: string }).name, arguments: jsonArgs((c as { args: unknown }).args) } })) }
          : {}),
      });
      continue;
    }
    for (const part of turn.parts) {
      if (part.type === "tool_result") messages.push({ role: "tool", tool_call_id: part.callId, content: part.content });
    }
    if (text) messages.push({ role: "user", content: text });
  }
  const tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: toolInputJsonSchema(tool) } }));
  return {
    endpointId: endpoint.id,
    url: `${endpoint.baseUrl}/chat/completions`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      model: request.model,
      messages,
      ...(tools.length ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
      ...(endpoint.officialOpenAi ? { max_completion_tokens: request.maxOutputTokens, store: false } : { max_tokens: request.maxOutputTokens }),
    },
    auth: endpoint.needsKey ? { header: "authorization", scheme: "Bearer" } : null,
    stream: true,
  };
}

// ------------------------------------------------------------------- Gemini

function buildGemini(endpoint: ProviderEndpoint, request: ModelRequest): HttpRequestSpec {
  const contents = request.conversation.turns.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: turn.parts
      .map((part) => {
        switch (part.type) {
          case "text":
            return { text: part.text };
          case "tool_call": {
            // A thought signature must come back with its call, unchanged.
            const signature = part.providerData?.provider === "gemini" ? (part.providerData.data as Record<string, unknown>) : {};
            return { functionCall: { name: part.name, args: part.args ?? {} }, ...signature };
          }
          case "tool_result":
            return { functionResponse: { name: part.name, response: part.isError ? { error: part.content } : { content: part.content } } };
          case "reasoning":
            return null;
        }
      })
      .filter((p) => p !== null),
  }));
  const tools = request.tools.length
    ? [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: toolInputJsonSchema(tool) })) }]
    : undefined;
  return {
    endpointId: endpoint.id,
    // The legacy generateContent endpoint: the Interactions API keeps data up to 55 days.
    url: `${endpoint.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      systemInstruction: { parts: [{ text: request.conversation.system }] },
      contents,
      ...(tools ? { tools } : {}),
      generationConfig: { maxOutputTokens: request.maxOutputTokens },
    },
    auth: endpoint.needsKey ? { header: "x-goog-api-key" } : null,
    stream: true,
  };
}

export function buildRequest(endpoint: ProviderEndpoint, request: ModelRequest): HttpRequestSpec {
  checkTools(request);
  switch (endpoint.api) {
    case "anthropic-messages":
      return buildAnthropic(endpoint, request);
    case "openai-responses":
      return buildOpenAiResponses(endpoint, request);
    case "openai-chat":
      return buildOpenAiChat(endpoint, request);
    case "gemini":
      return buildGemini(endpoint, request);
  }
}
