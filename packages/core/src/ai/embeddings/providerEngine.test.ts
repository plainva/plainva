import { describe, expect, it, vi } from "vitest";
import { toBase64 } from "../../workspace/encoding.js";
import type { ModelFailure } from "../egress.js";
import { BUILTIN_ENDPOINTS, type HttpRequestSpec, type ProviderEndpoint } from "../providers.js";
import { AI_EMBEDDING_PROFILE, DEFAULT_AI_APP_SETTINGS, SEMANTIC_BY_PROVIDER, type AiAppSettings } from "../registry.js";
import {
  PROVIDER_PROBE_TEXT,
  ProviderEmbeddingError,
  createProviderEmbeddingEngine,
  embeddingRequest,
  embeddingRoute,
  embeddingUsage,
  embeddingsOf,
  probeAgreement,
  type ProviderJsonAnswer,
} from "./providerEngine.js";
import { semanticSourceOf } from "./source.js";

const endpoint = (id: string): ProviderEndpoint => BUILTIN_ENDPOINTS.find((e) => e.id === id)!;

/** A vector for a text that only depends on the text: what a provider's model does. */
function vectorOf(text: string, dim = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i < dim; i++) out.push(((text.charCodeAt(i % text.length) * (i + 3)) % 17) + 1);
  return out;
}

const bodyOf = (spec: HttpRequestSpec) => spec.body as Record<string, unknown>;

/** An OpenAI-compatible server: answers every request with one vector per input, in scrambled order. */
function openAiServer(dim = 6) {
  const requests: HttpRequestSpec[] = [];
  const send = vi.fn(async (spec: HttpRequestSpec): Promise<ProviderJsonAnswer> => {
    requests.push(spec);
    const input = bodyOf(spec).input as string[];
    const data = input.map((text, index) => ({ object: "embedding", index, embedding: vectorOf(text, dim) })).reverse();
    return { ok: true, json: { data, usage: { prompt_tokens: input.length * 10, total_tokens: input.length * 10 } } };
  });
  return { send, requests };
}

/** Plan KI-Harness P2a-5: search by meaning with the embeddings route of an own provider. */
describe("embeddings from an own provider", () => {
  it("knows each protocol's route: OpenAI's way for every compatible server, Gemini its own, Anthropic none", () => {
    for (const id of ["openai", "openrouter", "ollama", "lmstudio"]) expect(embeddingRoute(endpoint(id))).toBe("openai-embeddings");
    expect(embeddingRoute({ id: "custom-1", api: "openai-chat", baseUrl: "https://llm.example.org/v1", needsKey: false })).toBe("openai-embeddings");
    expect(embeddingRoute(endpoint("gemini"))).toBe("gemini-embed");
    expect(embeddingRoute(endpoint("anthropic"))).toBeNull();
  });

  it("asks an OpenAI-compatible server at /embeddings, the key where the endpoint keeps it", () => {
    const spec = embeddingRequest(endpoint("openai"), "openai-embeddings", "text-embedding-3-small", ["eins", "zwei"], "document");
    expect(spec).toMatchObject({ url: "https://api.openai.com/v1/embeddings", method: "POST", auth: { header: "authorization", scheme: "Bearer" }, stream: false });
    expect(spec.body).toEqual({ model: "text-embedding-3-small", input: ["eins", "zwei"] });
    const local = embeddingRequest(endpoint("ollama"), "openai-embeddings", "nomic-embed-text", ["eins"], "query");
    expect(local.url).toBe("http://localhost:11434/v1/embeddings");
    expect(local.auth).toBeNull();
  });

  it("asks Gemini for a batch, telling questions from notes", () => {
    const spec = embeddingRequest(endpoint("gemini"), "gemini-embed", "models/gemini-embedding-001", ["Frage"], "query");
    expect(spec.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect(spec.auth).toEqual({ header: "x-goog-api-key" });
    expect(spec.body).toEqual({ requests: [{ model: "models/gemini-embedding-001", content: { parts: [{ text: "Frage" }] }, taskType: "RETRIEVAL_QUERY" }] });
    const notes = embeddingRequest(endpoint("gemini"), "gemini-embed", "gemini-embedding-001", ["a", "b"], "document");
    expect((bodyOf(notes).requests as { taskType: string }[]).map((r) => r.taskType)).toEqual(["RETRIEVAL_DOCUMENT", "RETRIEVAL_DOCUMENT"]);
  });

  it("reads the vectors in the order of the texts, as numbers or base64, and normalises them", () => {
    const answer = { data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }] };
    const vectors = embeddingsOf("openai-embeddings", answer, 2)!;
    expect(Array.from(vectors[0]!)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
    expect(Array.from(vectors[1]!)).toEqual([0, 1]);
    const packed = toBase64(new Uint8Array(new Float32Array([0, 0, 5]).buffer));
    expect(Array.from(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: packed }] }, 1)![0]!)).toEqual([0, 0, 1]);
    expect(Array.from(embeddingsOf("gemini-embed", { embeddings: [{ values: [1, 0] }] }, 1)![0]!)).toEqual([1, 0]);
  });

  it("refuses an answer that does not hold one vector per text of one length", () => {
    expect(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: [1, 0] }] }, 2)).toBeNull();
    expect(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1] }] }, 2)).toBeNull();
    expect(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }] }, 2)).toBeNull();
    expect(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: [1, "x"] }] }, 1)).toBeNull();
    expect(embeddingsOf("gemini-embed", { error: { message: "nope" } }, 1)).toBeNull();
    expect(embeddingsOf("openai-embeddings", null, 1)).toBeNull();
  });

  it("counts the tokens where the provider says them", () => {
    expect(embeddingUsage({ usage: { prompt_tokens: 42, total_tokens: 42 } })).toBe(42);
    expect(embeddingUsage({ embeddings: [] })).toBe(0);
  });

  it("learns the dimension from the probe — a fixed text, never a note — and sends 32 texts per request", async () => {
    const server = openAiServer(6);
    const usage: number[] = [];
    const engine = await createProviderEmbeddingEngine({ endpoint: endpoint("ollama"), route: "openai-embeddings", model: "nomic-embed-text", send: server.send, onUsage: (tokens) => usage.push(tokens) });
    expect(engine.id).toBe("provider:ollama/nomic-embed-text");
    expect(engine.dim).toBe(6);
    expect(bodyOf(server.requests[0]!).input).toEqual([PROVIDER_PROBE_TEXT]);
    const texts = Array.from({ length: 70 }, (_, i) => `Abschnitt ${i}`);
    const vectors = await engine.embed(texts, "document");
    expect(vectors).toHaveLength(70);
    expect(server.requests.slice(1).map((spec) => (bodyOf(spec).input as string[]).length)).toEqual([32, 32, 6]);
    // The order survives the server's scrambled answer.
    expect(Array.from(vectors[69]!)).toEqual(Array.from(embeddingsOf("openai-embeddings", { data: [{ index: 0, embedding: vectorOf("Abschnitt 69") }] }, 1)![0]!));
    expect(usage).toEqual([10, 320, 320, 60]);
    expect(await engine.embed([], "query")).toEqual([]);
  });

  it("waits as long as the provider asks, then tries again", async () => {
    const server = openAiServer();
    const failures: ModelFailure[] = [{ kind: "rate_limited", status: 429, retryAfterSeconds: 3 }, { kind: "overloaded", status: 503 }, { kind: "overloaded", status: 503 }];
    const send = vi.fn(async (spec: HttpRequestSpec): Promise<ProviderJsonAnswer> => (failures.length ? { ok: false, failure: failures.shift()! } : server.send(spec)));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const engine = await createProviderEmbeddingEngine({ endpoint: endpoint("openai"), route: "openai-embeddings", model: "text-embedding-3-small", send, sleep });
    expect(engine.dim).toBe(6);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 4000, 8000]);
  });

  it("gives up after five attempts, and at once on anything but 'later'", async () => {
    const sleep = vi.fn(async () => undefined);
    const busy = vi.fn(async (): Promise<ProviderJsonAnswer> => ({ ok: false, failure: { kind: "rate_limited", status: 429 } }));
    const error = await createProviderEmbeddingEngine({ endpoint: endpoint("openai"), route: "openai-embeddings", model: "m", send: busy, sleep }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderEmbeddingError);
    expect((error as ProviderEmbeddingError).failure.kind).toBe("rate_limited");
    expect(busy).toHaveBeenCalledTimes(5);
    const keyless = vi.fn(async (): Promise<ProviderJsonAnswer> => ({ ok: false, failure: { kind: "no_key" } }));
    const refused = await createProviderEmbeddingEngine({ endpoint: endpoint("openai"), route: "openai-embeddings", model: "m", send: keyless, sleep }).catch((e: unknown) => e);
    expect((refused as ProviderEmbeddingError).failure).toEqual({ kind: "no_key" });
    expect(keyless).toHaveBeenCalledTimes(1);
  });

  it("stops when the run is cancelled", async () => {
    const server = openAiServer();
    const engine = await createProviderEmbeddingEngine({ endpoint: endpoint("ollama"), route: "openai-embeddings", model: "m", send: server.send });
    const controller = new AbortController();
    controller.abort();
    await expect(engine.embed(["x"], "document", controller.signal)).rejects.toThrow();
    expect(server.requests).toHaveLength(1);
  });

  it("tells the same model from another by the probe's vector", () => {
    const probe = new Float32Array([0.6, 0.8, 0]);
    expect(probeAgreement(probe, new Float32Array([0.6, 0.8, 0]))).toBe(true);
    expect(probeAgreement(probe, new Float32Array([0.601, 0.799, 0.002]))).toBe(true);
    expect(probeAgreement(probe, new Float32Array([0, 0.6, 0.8]))).toBe(false);
    expect(probeAgreement(probe, new Float32Array([0.6, 0.8]))).toBe(false);
  });
});

describe("what computes the vectors on this device", () => {
  const settings = (change: Partial<AiAppSettings>): AiAppSettings => ({ ...DEFAULT_AI_APP_SETTINGS, enabled: true, ...change });

  it("is nothing while search by meaning or the AI is off", () => {
    expect(semanticSourceOf(settings({ semanticModel: null }))).toBeNull();
    expect(semanticSourceOf(settings({ enabled: false, semanticModel: "granite-r2-97m" }))).toBeNull();
  });

  it("is a catalog package by its id", () => {
    expect(semanticSourceOf(settings({ semanticModel: "granite-r2-97m" }))).toMatchObject({ kind: "package", key: "granite-r2-97m", spec: { id: "granite-r2-97m" } });
  });

  it("is the profile Embeddings, with the price the user entered and the route of its protocol", () => {
    const source = semanticSourceOf(
      settings({
        semanticModel: SEMANTIC_BY_PROVIDER,
        profiles: { [AI_EMBEDDING_PROFILE]: { providerId: "openai", model: "text-embedding-3-small" } },
        prices: { "openai/text-embedding-3-small": { input: 0.02, output: 0 } },
      }),
    );
    expect(source).toMatchObject({ kind: "provider", key: "provider:openai/text-embedding-3-small", target: { model: "text-embedding-3-small", route: "openai-embeddings", price: { input: 0.02, output: 0 } } });
    const anthropic = semanticSourceOf(settings({ semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId: "anthropic", model: "any" } } }));
    expect(anthropic).toMatchObject({ kind: "provider", target: { route: null } });
  });

  it("says when the profile Embeddings names no model", () => {
    expect(semanticSourceOf(settings({ semanticModel: SEMANTIC_BY_PROVIDER }))).toEqual({ kind: "provider", key: "provider:", target: null });
  });
});
