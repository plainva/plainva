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
  const body = spec.body;
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
    const shape = (s: HttpRequestSpec) => JSON.stringify([s.body.tools, s.body.system ?? s.body.instructions ?? s.body.systemInstruction]);
    for (const spec of specs) expect(shape(spec)).toBe(shape(specs[0]!));
  });

  it("never forces a tool choice", () => {
    for (const spec of specs) {
      expect(deepKeys(spec.body).has("tool_choice")).toBe(false);
      expect(deepKeys(spec.body).has("toolConfig")).toBe(false);
    }
  });

  it("sends the model exactly as chosen, to the endpoint and nowhere else", () => {
    for (const spec of specs) {
      expect(new URL(spec.url).host).toBe(new URL(endpoint.baseUrl).host);
      if (endpoint.api === "gemini") expect(spec.url).toContain("/models/chosen-model-7:streamGenerateContent");
      else expect(spec.body.model).toBe("chosen-model-7");
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
      if (endpoint.api === "openai-responses") expect(spec.body.store).toBe(false);
      if (endpoint.api === "openai-chat") expect(spec.body.store).toBe(endpoint.officialOpenAi ? false : undefined);
    }
  });

  it("streams", () => {
    for (const spec of specs) expect(spec.stream).toBe(true);
    if (endpoint.api === "gemini") expect(specs[0]!.url).toMatch(/alt=sse$/);
    else expect(specs[0]!.body.stream).toBe(true);
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

  it("returns Gemini's thought signature with its call, unchanged", () => {
    const spec = buildRequest(byId("gemini"), { model: "m", conversation: conversationFor("gemini")[1]!, tools, maxOutputTokens: 100 });
    expect(JSON.stringify(spec.body)).toContain('"functionCall":{"name":"search_vault","args":{"query":"Northwind deadline"}},"thoughtSignature":"ts1"');
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
