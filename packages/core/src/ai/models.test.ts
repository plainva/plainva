import { describe, expect, it } from "vitest";
import { modelListSpec, parseModelList } from "./models.js";
import { BUILTIN_ENDPOINTS } from "./providers.js";
import { AI_PROFILE_IDS, DEFAULT_AI_APP_SETTINGS, initialModelChoice, normalizeBaseUrl, readAiAppSettings, BUILTIN_PROVIDERS, allProviders, customEndpointId } from "./registry.js";

const endpoint = (id: string) => BUILTIN_ENDPOINTS.find((e) => e.id === id)!;

describe("model list (connection test)", () => {
  it("asks each provider's own list endpoint, by GET, with the key only where the egress puts it", () => {
    expect(modelListSpec(endpoint("anthropic"))).toMatchObject({ method: "GET", url: "https://api.anthropic.com/v1/models?limit=1000", stream: false, auth: { header: "x-api-key" }, headers: { "anthropic-version": "2023-06-01" } });
    expect(modelListSpec(endpoint("gemini"))).toMatchObject({ method: "GET", url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", auth: { header: "x-goog-api-key" } });
    expect(modelListSpec(endpoint("openai")).url).toBe("https://api.openai.com/v1/models");
    expect(modelListSpec(endpoint("ollama"))).toMatchObject({ url: "http://localhost:11434/v1/models", auth: null });
    for (const e of BUILTIN_ENDPOINTS) expect(modelListSpec(e).body).toBeUndefined();
  });

  it("reads every provider's shape and never throws on a strange one", () => {
    expect(parseModelList(endpoint("anthropic"), { data: [{ id: "m-a", display_name: "Model A" }] })).toEqual([{ id: "m-a", label: "Model A", contextTokens: undefined, price: undefined, chat: true, transcribe: false }]);
    const gemini = parseModelList(endpoint("gemini"), {
      models: [
        { name: "models/m-g", displayName: "G", inputTokenLimit: 1000, outputTokenLimit: 100, supportedGenerationMethods: ["generateContent"] },
        { name: "models/e-g", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    expect(gemini).toEqual([
      { id: "m-g", label: "G", contextTokens: 1000, outputTokens: 100, chat: true, transcribe: true },
      { id: "e-g", label: undefined, contextTokens: undefined, outputTokens: undefined, chat: false, transcribe: false },
    ]);
    const router = parseModelList(endpoint("openrouter"), { data: [{ id: "vendor/model", name: "Vendor Model", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" } }] });
    expect(router[0]!.price).toEqual({ input: 3, output: 15 });
    expect(parseModelList(endpoint("openai"), { data: [{ id: "text-embedding-9" }, { id: "chat-9" }] }).map((m) => [m.id, m.chat])).toEqual([["text-embedding-9", false], ["chat-9", true]]);
    for (const junk of [null, 1, "x", { data: "no" }, { data: [null, 3, { id: 5 }] }, { models: [{}] }]) {
      expect(parseModelList(endpoint("openai"), junk)).toEqual([]);
      expect(parseModelList(endpoint("gemini"), junk)).toEqual([]);
    }
  });
});

describe("provider registry", () => {
  it("lists every stage A and B provider, each with a hint and none hidden", () => {
    expect(BUILTIN_PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini", "openrouter", "ollama", "lmstudio"]);
    for (const p of BUILTIN_PROVIDERS) expect(p.hints.length).toBeGreaterThan(0);
  });

  it("accepts https anywhere and plain http only on this device", () => {
    expect(normalizeBaseUrl(" https://AI.Example.org/v1/ ")).toEqual({ baseUrl: "https://ai.example.org/v1", local: false });
    expect(normalizeBaseUrl("http://localhost:8080/v1")).toEqual({ baseUrl: "http://localhost:8080/v1", local: true });
    expect(normalizeBaseUrl("http://127.0.0.1:1234")).toEqual({ baseUrl: "http://127.0.0.1:1234", local: true });
    for (const bad of ["http://ai.example.org/v1", "https://user:pw@example.org", "ftp://example.org", "not a url", "javascript:alert(1)"]) expect(normalizeBaseUrl(bad)).toBeNull();
  });

  it("gives custom servers their own ids and a place in the list", () => {
    expect(customEndpointId(["custom-1", "custom-3"])).toBe("custom-2");
    const list = allProviders([{ id: "custom-1", label: "Office", baseUrl: "https://llm.office.example/v1", api: "openai-chat", local: false }]);
    expect(list.at(-1)).toMatchObject({ id: "custom-1", label: "Office", custom: true, kind: "gateway", endpoint: { needsKey: false } });
  });

  it("reads stored settings field by field and never loses the defaults to a damaged value", () => {
    expect(readAiAppSettings(undefined)).toEqual(DEFAULT_AI_APP_SETTINGS);
    const read = readAiAppSettings({
      enabled: true,
      profiles: { fast: { providerId: "openai", model: " m-fast " }, strong: { providerId: 3 }, bogus: { providerId: "x", model: "y" } },
      defaultProfile: "fast",
      custom: [{ id: "custom-1", label: "Office", baseUrl: "https://llm.example/v1" }, { id: "evil", label: "x", baseUrl: "https://x" }, { id: "custom-2", label: "Plain", baseUrl: "http://remote.example" }],
      historyDays: -4,
      prices: { "openai/m-fast": { input: 1, output: 2 }, broken: { input: "1" } },
    });
    expect(read.enabled).toBe(true);
    expect(read.profiles).toEqual({ fast: { providerId: "openai", model: "m-fast" } });
    expect(read.defaultProfile).toBe("fast");
    expect(read.custom.map((c) => c.id)).toEqual(["custom-1"]);
    expect(read.historyDays).toBe(DEFAULT_AI_APP_SETTINGS.historyDays);
    expect(read.prices).toEqual({ "openai/m-fast": { input: 1, output: 2 } });
    expect(initialModelChoice(read)).toEqual({ providerId: "openai", model: "m-fast" });
    expect(initialModelChoice({ ...read, defaultProfile: "strong" })).toEqual({ providerId: "openai", model: "m-fast" });
    expect(initialModelChoice(DEFAULT_AI_APP_SETTINGS)).toBeNull();
    expect(AI_PROFILE_IDS).toEqual(["fast", "balanced", "strong", "local"]);
  });

  it("keeps the search-by-meaning settings of a device only when they name a real model and mode", () => {
    expect(DEFAULT_AI_APP_SETTINGS).toMatchObject({ semanticModel: null, searchMode: "both" });
    expect(readAiAppSettings({ semanticModel: "granite-r2-97m", searchMode: "meaning" })).toMatchObject({ semanticModel: "granite-r2-97m", searchMode: "meaning" });
    expect(readAiAppSettings({ semanticModel: "no-such-model", searchMode: "vibes" })).toMatchObject({ semanticModel: null, searchMode: "both" });
  });
});
