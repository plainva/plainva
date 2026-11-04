import { describe, expect, it } from "vitest";
import { appendTurn, startConversation, type Conversation } from "./conversation.js";
import { failureFromChunk } from "./egress.js";
import { modelListSpec, parseModelList } from "./models.js";
import { contextBudgetFor, estimatePromptTokens, PLATFORM_ANSWER_TOKENS, platformPrompt } from "./platform.js";
import { buildRequest } from "./providers.js";
import { providerById, recipientOf } from "./registry.js";
import { createSseParser, createStreamDecoder } from "./streams.js";

const apple = providerById("apple", [])!;
const nano = providerById("gemini-nano", [])!;

function talk(turns: Array<["user" | "assistant", string, string?]>): Conversation {
  let c = startConversation("c1", "Answer from the notes.", []);
  for (const [role, text, context] of turns) {
    c = appendTurn(c, { role, at: "2026-10-01T09:00:00Z", parts: [...(context ? [{ type: "text" as const, text: context, context: ["Note.md#1"] }] : []), { type: "text" as const, text }] });
  }
  return c;
}

/** Plan KI-Harness P2c: the system's own model, fitted into its small window. */
describe("platform models", () => {
  it("are providers on this device, for their own system", () => {
    expect(apple).toMatchObject({ kind: "platform-device", os: "ios", endpoint: { api: "platform", needsKey: false } });
    expect(nano).toMatchObject({ kind: "platform-device", os: "android", endpoint: { api: "platform", needsKey: false } });
    expect(recipientOf(apple, "on-device")).toEqual({ kind: "platform-device", provider: "apple", model: "on-device" });
    expect(recipientOf(providerById("openrouter", [])!, "x").kind).toBe("cloud");
    expect(recipientOf(providerById("ollama", [])!, "x").kind).toBe("local");
  });

  it("estimate tokens cautiously across scripts", () => {
    expect(estimatePromptTokens("a".repeat(320))).toBe(100);
    expect(estimatePromptTokens("会議の議事録")).toBe(6);
  });

  it("shrink the context package for a small window, and leave a large one alone", () => {
    const small = contextBudgetFor(4_096)!;
    expect(small.evidence).toBe(2);
    expect(small.cards).toBe(2);
    expect(small.evidenceChars).toBeLessThan(6_000);
    expect(contextBudgetFor(200_000)).toBeNull();
    expect(contextBudgetFor(undefined)).toBeNull();
  });

  it("send the latest message whole and as much of the earlier words as fits, never the earlier notes", () => {
    const c = talk([
      ["user", "First question", "Notes sent with the first question"],
      ["assistant", "First answer"],
      ["user", "Second question", "Notes for the second question"],
    ]);
    const { instructions, prompt } = platformPrompt(c, { contextTokens: 4_096, answerTokens: 700 });
    expect(instructions).toBe("Answer from the notes.");
    expect(prompt).toContain("User: First question");
    expect(prompt).toContain("Assistant: First answer");
    expect(prompt).not.toContain("Notes sent with the first question");
    expect(prompt.endsWith("Notes for the second question\n\nSecond question")).toBe(true);
  });

  it("drop the oldest turns first when the window is full", () => {
    const long = "word ".repeat(2000);
    const c = talk([
      ["user", `Old ${long}`],
      ["assistant", `Old answer ${long}`],
      ["user", "Recent question"],
      ["assistant", "Recent answer"],
      ["user", "Now"],
    ]);
    const { prompt, dropped } = platformPrompt(c, { contextTokens: 2_000, answerTokens: 500 });
    expect(prompt).toContain("Recent answer");
    expect(prompt).not.toContain("Old answer");
    expect(dropped).toBe(2);
  });

  it("go to the native plugin as one request without tools or key, and stream back in their own dialect", () => {
    const spec = buildRequest(apple.endpoint, { model: "on-device", conversation: talk([["user", "Hi"]]), tools: [], maxOutputTokens: 32_000, contextTokens: 4_096 });
    expect(spec).toMatchObject({ endpointId: "apple", url: "platform://apple/generate", method: "POST", auth: null, stream: true });
    expect(spec.body).toEqual({ instructions: "Answer from the notes.", prompt: "Hi", maxOutputTokens: PLATFORM_ANSWER_TOKENS });
    const parser = createSseParser();
    const decoder = createStreamDecoder("platform");
    const events = parser
      .push('data: {"text":"Hel"}\n\ndata: {"text":"lo"}\n\ndata: {"stop":"end","usage":{"inputTokens":40,"outputTokens":2}}\n\n')
      .flatMap((m) => decoder.push(m));
    expect(events).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", inputTokens: 40, outputTokens: 2 },
      { type: "stop", reason: "end" },
    ]);
  });

  it("report the model and its window through the same test as any provider", () => {
    expect(modelListSpec(nano.endpoint)).toMatchObject({ url: "platform://gemini-nano/models", method: "GET", auth: null });
    expect(parseModelList(nano.endpoint, { data: [{ id: "on-device", name: "Gemini Nano", context_length: 4_000 }] })).toEqual([
      expect.objectContaining({ id: "on-device", label: "Gemini Nano", contextTokens: 4_000, chat: true }),
    ]);
  });

  it("say why they are not there, in terms the settings can act on", () => {
    expect(failureFromChunk("platform_unavailable", "appleIntelligenceNotEnabled")).toEqual({ kind: "platform_unavailable", reason: "appleIntelligenceNotEnabled" });
    expect(failureFromChunk("context_too_long", "exceeded")).toEqual({ kind: "context_too_long", status: 0 });
    expect(failureFromChunk("rate_limited", "quota")).toEqual({ kind: "rate_limited", status: 0 });
    expect(failureFromChunk("platform_refused", "guardrail")).toEqual({ kind: "refused_by_provider", status: 0, message: "guardrail" });
  });
});
