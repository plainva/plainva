import type { HttpRequestSpec, ProviderEndpoint } from "./providers.js";

/**
 * The provider's own model list — the connection test and the source of the
 * model picker's suggestions (§11.1). Plainva ships no list of "allowed"
 * models: whatever the provider offers can be chosen, and any id can be typed
 * in by hand (principle 13 of the plan).
 */

export interface ModelInfo {
  /** Exactly the string the provider expects in a request. */
  id: string;
  /** The provider's display name, when it gives one. */
  label?: string;
  contextTokens?: number;
  outputTokens?: number;
  /** US dollars per million tokens, where the provider publishes prices with the list. */
  price?: { input: number; output: number };
  /**
   * False for what the list itself marks as something else (embeddings,
   * speech, images, moderation). Only a sorting hint: such a model can still
   * be typed in.
   */
  chat: boolean;
}

export function modelListSpec(endpoint: ProviderEndpoint): HttpRequestSpec {
  const base = endpoint.baseUrl;
  switch (endpoint.api) {
    case "anthropic-messages":
      return {
        endpointId: endpoint.id,
        url: `${base}/models?limit=1000`,
        method: "GET",
        headers: { "anthropic-version": "2023-06-01" },
        auth: endpoint.needsKey ? { header: "x-api-key" } : null,
        stream: false,
      };
    case "gemini":
      return {
        endpointId: endpoint.id,
        url: `${base}/models?pageSize=1000`,
        method: "GET",
        headers: {},
        auth: endpoint.needsKey ? { header: "x-goog-api-key" } : null,
        stream: false,
      };
    case "openai-responses":
    case "openai-chat":
      return {
        endpointId: endpoint.id,
        url: `${base}/models`,
        method: "GET",
        headers: {},
        auth: endpoint.needsKey ? { header: "authorization", scheme: "Bearer" } : null,
        stream: false,
      };
  }
}

const NOT_CHAT = /(^|[/:-])(text-embedding|embedding|embed|tts|whisper|transcribe|dall-e|gpt-image|image|moderation|rerank|babbage|davinci)([-.:/]|$)/i;

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object") : [];
}

/** Parses a model list answer; unknown shapes give an empty list, never a throw. */
export function parseModelList(endpoint: ProviderEndpoint, json: unknown): ModelInfo[] {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const out: ModelInfo[] = [];
  if (endpoint.api === "gemini") {
    for (const m of records(root.models)) {
      const name = str(m.name);
      if (!name) continue;
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      out.push({
        id: name.replace(/^models\//, ""),
        label: str(m.displayName),
        contextTokens: num(m.inputTokenLimit),
        outputTokens: num(m.outputTokenLimit),
        chat: methods.includes("generateContent") || methods.includes("streamGenerateContent"),
      });
    }
  } else {
    for (const m of records(root.data)) {
      const id = str(m.id);
      if (!id) continue;
      const pricing = m.pricing && typeof m.pricing === "object" ? (m.pricing as Record<string, unknown>) : undefined;
      const input = num(pricing?.prompt);
      const output = num(pricing?.completion);
      const modality = m.architecture && typeof m.architecture === "object" ? str((m.architecture as Record<string, unknown>).modality) : undefined;
      out.push({
        id,
        label: str(m.display_name) ?? str(m.name),
        contextTokens: num(m.context_length) ?? num(m.context_window),
        price: input !== undefined && output !== undefined ? { input: input * 1_000_000, output: output * 1_000_000 } : undefined,
        chat: modality ? /->.*text/.test(modality) && !NOT_CHAT.test(id) : !NOT_CHAT.test(id),
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}
