/**
 * Search by meaning with an own provider (plan KI-Harness P2a-5): the
 * embeddings route of a provider the user set up — OpenAI and every server
 * that speaks its protocol (OpenRouter, Ollama, LM Studio, a custom
 * endpoint) at `/embeddings`, Gemini at `batchEmbedContents`. Anthropic has
 * no embeddings route. A hint, never a lock: any model the route accepts can
 * be used, in the catalog or not (principle 13).
 *
 * The keys stay in the native egress; this module builds the request
 * specifications and reads the answers. The engine learns its dimension from
 * a probe — one fixed text, never a note — and keeps the probe's vector as
 * the model's fingerprint: a model replaced on a local server, or a custom
 * address pointed at another server, answers the probe differently, and the
 * vectors of the old one are dropped instead of mixed (`probeAgreement`).
 */
import type { ModelFailure } from "../egress.js";
import type { HttpRequestSpec, ProviderEndpoint } from "../providers.js";
import { fromBase64 } from "../../workspace/encoding.js";
import { GOLDEN_TEXT } from "./catalog.js";
import type { EmbeddingEngine, EmbeddingKind } from "./engine.js";
import { l2Normalize } from "./vectors.js";

export type EmbeddingRoute = "openai-embeddings" | "gemini-embed";

/** How a provider embeds texts; null where its protocol has no embeddings (Anthropic). */
export function embeddingRoute(endpoint: ProviderEndpoint): EmbeddingRoute | null {
  switch (endpoint.api) {
    case "gemini":
      return "gemini-embed";
    case "openai-responses":
    case "openai-chat":
      return "openai-embeddings";
    case "anthropic-messages":
      return null;
  }
}

/**
 * Texts per request. The pipeline hands over at most 32 chunks per call
 * (`EMBED_CALL_CHUNKS`); Gemini takes 100 per batch, OpenAI 2048.
 */
export const PROVIDER_EMBED_BATCH = 32;

/** The engine id of a provider's model: the vectors of two models never mix. */
export function providerEngineId(endpointId: string, model: string): string {
  return `provider:${endpointId}/${model}`;
}

/** Gemini names a model `models/<id>`; the list and the settings keep the bare id. */
function geminiModel(model: string): string {
  return model.replace(/^models\//, "");
}

/** The request for a few texts, as questions or as the chunks of notes. */
export function embeddingRequest(endpoint: ProviderEndpoint, route: EmbeddingRoute, model: string, texts: readonly string[], kind: EmbeddingKind): HttpRequestSpec {
  if (route === "gemini-embed") {
    const id = geminiModel(model);
    return {
      endpointId: endpoint.id,
      url: `${endpoint.baseUrl}/models/${encodeURIComponent(id)}:batchEmbedContents`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        requests: texts.map((text) => ({
          model: `models/${id}`,
          content: { parts: [{ text }] },
          taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        })),
      },
      auth: endpoint.needsKey ? { header: "x-goog-api-key" } : null,
      stream: false,
    };
  }
  // No `encoding_format`: floats are the protocol's default, and a strict server may reject a field it does not know.
  return {
    endpointId: endpoint.id,
    url: `${endpoint.baseUrl}/embeddings`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model, input: [...texts] },
    auth: endpoint.needsKey ? { header: "authorization", scheme: "Bearer" } : null,
    stream: false,
  };
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A vector as JSON numbers, or as base64 little-endian float32 (`encoding_format: "base64"`). */
function floats(value: unknown): Float32Array | null {
  if (Array.isArray(value)) {
    if (!value.length) return null;
    const out = new Float32Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const n: unknown = value[i];
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      out[i] = n;
    }
    return out;
  }
  if (typeof value === "string") {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(value);
    } catch {
      return null;
    }
    if (!bytes.length || bytes.length % 4 !== 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(bytes.length / 4);
    for (let i = 0; i < out.length; i++) {
      const n = view.getFloat32(i * 4, true);
      if (!Number.isFinite(n)) return null;
      out[i] = n;
    }
    return out;
  }
  return null;
}

/**
 * The vectors of an answer, L2-normalised, in the order of the texts; null
 * unless it holds exactly one per text, all of one length.
 */
export function embeddingsOf(route: EmbeddingRoute, json: unknown, count: number): Float32Array[] | null {
  const root = record(json);
  let vectors: (Float32Array | null)[];
  if (route === "gemini-embed") {
    const list: unknown = root?.embeddings;
    if (!Array.isArray(list)) return null;
    vectors = list.map((item: unknown) => floats(record(item)?.values));
  } else {
    const list: unknown = root?.data;
    if (!Array.isArray(list)) return null;
    const items = list.map((item: unknown, i: number) => {
      const entry = record(item);
      const index = entry?.index;
      return { index: typeof index === "number" ? index : i, vector: floats(entry?.embedding) };
    });
    items.sort((a, b) => a.index - b.index);
    if (items.some((item, i) => item.index !== i)) return null;
    vectors = items.map((item) => item.vector);
  }
  if (vectors.length !== count) return null;
  const dim = vectors[0]?.length ?? 0;
  if (!dim || vectors.some((vector) => !vector || vector.length !== dim)) return null;
  return vectors.map((vector) => l2Normalize(vector!));
}

/** The input tokens a provider counted, where it says so (OpenAI and servers like it); 0 otherwise. */
export function embeddingUsage(json: unknown): number {
  const usage = record(record(json)?.usage);
  const tokens = usage?.prompt_tokens ?? usage?.total_tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : 0;
}

/** A request that ended without vectors: the failure in the terms the settings explain. */
export class ProviderEmbeddingError extends Error {
  constructor(readonly failure: ModelFailure) {
    super(`embedding provider: ${failure.kind}${"message" in failure && failure.message ? ` (${failure.message})` : ""}`);
    this.name = "ProviderEmbeddingError";
  }
}

export type ProviderJsonAnswer = { ok: true; json: unknown } | { ok: false; failure: ModelFailure };

export interface ProviderEmbeddingOptions {
  endpoint: ProviderEndpoint;
  route: EmbeddingRoute;
  model: string;
  /** One request through the native egress; the signal cancels it. */
  send(spec: HttpRequestSpec, signal?: AbortSignal): Promise<ProviderJsonAnswer>;
  /** Each answered request: the input tokens the provider counted (0 where it says nothing). */
  onUsage?(inputTokens: number): void;
  /** Waits before another attempt; tests pass their own. */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  /** Cancels the probe. */
  signal?: AbortSignal;
}

export interface ProviderEmbeddingEngine extends EmbeddingEngine {
  /** The probe's vector: the fingerprint of the model behind the route. */
  readonly probe: Float32Array;
}

/** The probe: the device check's text, so no note is ever needed to learn the model. */
export const PROVIDER_PROBE_TEXT = GOLDEN_TEXT;

/** Attempts of one request while the provider says "later" (429, 503, 529). */
const ATTEMPTS = 5;
const FIRST_WAIT_MS = 2_000;
const LONGEST_WAIT_MS = 60_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal!.reason);
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * An own provider's model as an engine. Opening it sends the probe — the
 * first request, before any note — and learns the dimension from it. A
 * request the provider asks to slow down is repeated after the wait it names
 * (else 2, 4, 8 … up to 60 seconds), five times at most; every other failure
 * ends the call with a `ProviderEmbeddingError`.
 */
export async function createProviderEmbeddingEngine(options: ProviderEmbeddingOptions): Promise<ProviderEmbeddingEngine> {
  const { endpoint, route, model, send } = options;
  const sleep = options.sleep ?? defaultSleep;
  const request = async (texts: readonly string[], kind: EmbeddingKind, signal?: AbortSignal): Promise<Float32Array[]> => {
    let wait = FIRST_WAIT_MS;
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      const answer = await send(embeddingRequest(endpoint, route, model, texts, kind), signal);
      signal?.throwIfAborted();
      if (answer.ok) {
        const vectors = embeddingsOf(route, answer.json, texts.length);
        if (!vectors) throw new ProviderEmbeddingError({ kind: "provider_error", message: "the answer holds no embeddings" });
        options.onUsage?.(embeddingUsage(answer.json));
        return vectors;
      }
      const failure = answer.failure;
      if ((failure.kind !== "rate_limited" && failure.kind !== "overloaded") || attempt >= ATTEMPTS) throw new ProviderEmbeddingError(failure);
      const named = failure.kind === "rate_limited" && failure.retryAfterSeconds !== undefined ? failure.retryAfterSeconds * 1000 : null;
      await sleep(Math.min(LONGEST_WAIT_MS, named ?? wait), signal);
      wait = Math.min(LONGEST_WAIT_MS, wait * 2);
    }
  };
  const [probe] = await request([PROVIDER_PROBE_TEXT], "document", options.signal);
  const dim = probe!.length;
  let disposed = false;
  return {
    id: providerEngineId(endpoint.id, model),
    dim,
    probe: probe!,
    async embed(texts, kind, signal) {
      if (disposed) throw new Error("embedding engine: disposed");
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += PROVIDER_EMBED_BATCH) {
        const vectors = await request(texts.slice(i, i + PROVIDER_EMBED_BATCH), kind, signal);
        if (vectors[0]!.length !== dim) throw new ProviderEmbeddingError({ kind: "provider_error", message: `${vectors[0]!.length} values instead of ${dim}` });
        out.push(...vectors);
      }
      return out;
    },
    async dispose() {
      disposed = true;
    },
  };
}

/** Cosine that tells the same model (cloud answers differ in the last digits) from another one. */
export const PROBE_MIN_COSINE = 0.98;

/** Whether a stored probe and a fresh one came from the same model. */
export function probeAgreement(stored: Float32Array, fresh: Float32Array): boolean {
  if (stored.length !== fresh.length || !stored.length) return false;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < stored.length; i++) {
    dot += stored[i]! * fresh[i]!;
    a += stored[i]! * stored[i]!;
    b += fresh[i]! * fresh[i]!;
  }
  const cosine = a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
  return Number.isFinite(cosine) && cosine >= PROBE_MIN_COSINE;
}
