import { describe, expect, it } from "vitest";
import { appendTurn, openToolCalls, startConversation, type Conversation } from "./conversation.js";
import { BUILTIN_ENDPOINTS, buildRequest, type HttpRequestSpec, type ProviderEndpoint } from "./providers.js";
import { coreTools } from "./tools.js";

/**
 * Provider conformance (ADR 0016): every adapter, one set of rules. The
 * requests are specifications — nothing leaves the test — so each rule is
 * checked on exactly what the native egress would send.
 */

const tools = coreTools();
const at = "2026-09-24T10:00:00Z";

function conversationFor(provider: string): Conversation[] {
  let c = startConversation("c1", "You are Plainva's vault assistant.", tools.map((t) => t.name));
  const steps: Conversation[] = [];
  c = appendTurn(c, { role: "user", parts: [{ type: "text", text: "When is the Northwind deadline?" }], at });
  steps.push(c);
  c = appendTurn(c, {
    role: "assistant",
    provider,
    model: "m",
    at,
    parts: [
      { type: "reasoning", provider, data: provider === "anthropic" ? { type: "thinking", thinking: "…", signature: "sig" } : { type: "reasoning", id: "r1", encrypted_content: "enc" } },
      { type: "tool_call", id: "call_1", name: "search_vault", args: { query: "Northwind deadline" }, providerData: provider === "gemini" ? { provider: "gemini", data: { thoughtSignature: "ts1" } } : undefined },
    ],
  });
  steps.push(c);
  c = appendTurn(c, { role: "user", at, parts: [{ type: "tool_result", callId: "call_1", name: "search_vault", content: '<untrusted_data origin="vault:Projects/Offer.md" trust="3">\ndeadline 2026-11-14\n</untrusted_data>' }] });
  steps.push(c);
  c = appendTurn(c, { role: "assistant", provider, model: "m", at, parts: [{ type: "text", text: "The deadline is 2026-11-14 [Projects/Offer.md]." }] });
  steps.push(c);
  c = appendTurn(c, { role: "user", at, parts: [{ type: "text", text: "And the budget?" }] });
  steps.push(c);
  return steps;
}

function history(spec: HttpRequestSpec): unknown[] {
  const body = spec.body!;
  return (body.messages ?? body.input ?? body.contents) as unknown[];
}

function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

const cases: Array<[string, ProviderEndpoint]> = BUILTIN_ENDPOINTS.map((e) => [e.id, e]);

describe.each(cases)("provider conformance: %s", (_id, endpoint) => {
  const provider = endpoint.id;
  const steps = conversationFor(provider);
  const specs = steps.map((conversation) => buildRequest(endpoint, { model: "chosen-model-7", conversation, tools, maxOutputTokens: 1024, cache: true }));

  it("is append-only: every request starts with the previous one, byte for byte", () => {
    for (let i = 1; i < specs.length; i++) {
      const before = history(specs[i - 1]!).map((m) => JSON.stringify(m));
      const after = history(specs[i]!).map((m) => JSON.stringify(m));
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after.length).toBeGreaterThan(before.length);
    }
  });

  it("keeps the tool list and the system prompt stable for the whole conversation", () => {
    const shape = (s: HttpRequestSpec) => JSON.stringify([s.body!.tools, s.body!.system ?? s.body!.instructions ?? s.body!.systemInstruction]);
    for (const spec of specs) expect(shape(spec)).toBe(shape(specs[0]!));
  });

  it("never forces a tool choice", () => {
    for (const spec of specs) {
      expect(deepKeys(spec.body).has("tool_choice")).toBe(false);
      expect(deepKeys(spec.body).has("toolConfig")).toBe(false);
      expect(spec.method).toBe("POST");
    }
  });

  it("sends the model exactly as chosen, to the endpoint and nowhere else", () => {
    for (const spec of specs) {
      expect(new URL(spec.url).host).toBe(new URL(endpoint.baseUrl).host);
      if (endpoint.api === "gemini") expect(spec.url).toContain("/models/chosen-model-7:streamGenerateContent");
      else expect(spec.body!.model).toBe("chosen-model-7");
      // A bare "provider/model" string routes through a gateway in some SDKs;
      // the adapters never invent one.
      expect(JSON.stringify(spec)).not.toMatch(/"(openai|anthropic|google)\/chosen-model-7"/);
    }
  });

  it("carries no key: only where the native egress puts it", () => {
    const spec = specs[0]!;
    expect(Object.keys(spec.headers).sort()).toEqual(endpoint.api === "anthropic-messages" ? ["anthropic-version", "content-type"] : ["content-type"]);
    expect(spec.auth).toEqual(
      !endpoint.needsKey ? null
        : endpoint.api === "anthropic-messages" ? { header: "x-api-key" }
          : endpoint.api === "gemini" ? { header: "x-goog-api-key" }
            : { header: "authorization", scheme: "Bearer" },
    );
    expect(spec.url).not.toMatch(/[?&]key=/);
  });

  it("switches off provider-side storage where the API allows it", () => {
    for (const spec of specs) {
      if (endpoint.api === "openai-responses") expect(spec.body!.store).toBe(false);
      if (endpoint.api === "openai-chat") expect(spec.body!.store).toBe(endpoint.officialOpenAi ? false : undefined);
    }
  });

  it("streams", () => {
    for (const spec of specs) expect(spec.stream).toBe(true);
    if (endpoint.api === "gemini") expect(specs[0]!.url).toMatch(/alt=sse$/);
    else expect(specs[0]!.body!.stream).toBe(true);
  });
});

describe("provider specifics", () => {
  const byId = (id: string) => BUILTIN_ENDPOINTS.find((e) => e.id === id)!;

  it("reasoning goes back only to the provider that wrote it", () => {
    const fromOpenAi = conversationFor("openai")[1]!;
    const anthropic = buildRequest(byId("anthropic"), { model: "m", conversation: fromOpenAi, tools, maxOutputTokens: 100 });
    expect(JSON.stringify(anthropic.body)).not.toContain("encrypted_content");
    const openai = buildRequest(byId("openai"), { model: "m", conversation: fromOpenAi, tools, maxOutputTokens: 100 });
    expect(JSON.stringify(openai.body)).toContain('"encrypted_content":"enc"');
    const fromAnthropic = conversationFor("anthropic")[1]!;
    expect(JSON.stringify(buildRequest(byId("anthropic"), { model: "m", conversation: fromAnthropic, tools, maxOutputTokens: 100 }).body)).toContain('"signature":"sig"');
  });

  it("a conversation moves to another provider whole: every turn, every call with its result", () => {
    // Started on Anthropic, continued on each other dialect (plan §6: the user picks the model, per message if they like).
    const fromAnthropic = conversationFor("anthropic")[4]!;
    const words = ["When is the Northwind deadline?", "deadline 2026-11-14", "The deadline is 2026-11-14", "And the budget?"];
    const openai = buildRequest(byId("openai"), { model: "m", conversation: fromAnthropic, tools, maxOutputTokens: 100 });
    const items = openai.body!.input as Array<Record<string, unknown>>;
    expect(items.filter((i) => i.type === "function_call").map((i) => [i.call_id, i.name])).toEqual([["call_1", "search_vault"]]);
    expect(items.filter((i) => i.type === "function_call_output").map((i) => i.call_id)).toEqual(["call_1"]);
    const chat = buildRequest(byId("openrouter"), { model: "m", conversation: fromAnthropic, tools, maxOutputTokens: 100 }).body!.messages as Array<Record<string, unknown>>;
    expect(chat.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
    expect((chat[2]!.tool_calls as Array<{ id: string }>)[0]!.id).toBe("call_1");
    expect(chat[3]!.tool_call_id).toBe("call_1");
    const gemini = buildRequest(byId("gemini"), { model: "m", conversation: fromAnthropic, tools, maxOutputTokens: 100 }).body!.contents as Array<{ role: string; parts: Record<string, unknown>[] }>;
    expect(gemini.map((m) => m.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(Object.keys(gemini[1]!.parts[0]!)).toContain("functionCall");
    expect(Object.keys(gemini[2]!.parts[0]!)).toContain("functionResponse");
    for (const body of [openai.body, { messages: chat }, { contents: gemini }]) {
      const text = JSON.stringify(body);
      for (const word of words) expect(text).toContain(word);
      // Anthropic's thinking stays with Anthropic.
      expect(text).not.toContain('"signature"');
    }
  });

  it("returns Gemini's thought signature with its call, unchanged", () => {
    const spec = buildRequest(byId("gemini"), { model: "m", conversation: conversationFor("gemini")[1]!, tools, maxOutputTokens: 100 });
    expect(JSON.stringify(spec.body)).toContain('"functionCall":{"name":"search_vault","args":{"query":"Northwind deadline"}},"thoughtSignature":"ts1"');
  });

  it("sends two user turns in a row as one message where the API wants turns to alternate", () => {
    // A stopped run answers its open calls "not run"; the next message follows directly.
    let c = conversationFor("anthropic")[1]!;
    c = appendTurn(c, { role: "user", at, parts: [{ type: "tool_result", callId: "call_1", name: "search_vault", content: "Not run: the user stopped the run.", isError: true }] });
    c = appendTurn(c, { role: "user", at, parts: [{ type: "text", text: "Never mind." }] });
    const anthropic = buildRequest(byId("anthropic"), { model: "m", conversation: c, tools, maxOutputTokens: 100 }).body!.messages as Array<{ role: string; content: Array<{ type: string }> }>;
    expect(anthropic.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(anthropic[2]!.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
    const gemini = buildRequest(byId("gemini"), { model: "m", conversation: c, tools, maxOutputTokens: 100 }).body!.contents as Array<{ role: string; parts: Record<string, unknown>[] }>;
    expect(gemini.map((m) => m.role)).toEqual(["user", "model", "user"]);
    expect(gemini[2]!.parts.map((p) => Object.keys(p)[0])).toEqual(["functionResponse", "text"]);
  });

  it("refuses a tool list that differs from the conversation's", () => {
    const conversation = conversationFor("anthropic")[0]!;
    expect(() => buildRequest(byId("anthropic"), { model: "m", conversation, tools: tools.slice(1), maxOutputTokens: 100 })).toThrow(/fixed per conversation/);
  });

  it("the history cannot be edited after it was sent", () => {
    const [first] = conversationFor("anthropic");
    expect(() => {
      (first!.turns[0]!.parts as unknown as Array<{ text: string }>)[0]!.text = "rewritten";
    }).toThrow();
    expect(openToolCalls(conversationFor("anthropic")[1]!).map((c) => c.id)).toEqual(["call_1"]);
  });
});
