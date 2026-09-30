/**
 * What computes the vectors of search by meaning on this device (plan
 * KI-Harness P2a-4/P2a-5): a catalog package run by the native runtime, or
 * the model of the profile "Embeddings" at an own provider — a server on this
 * computer (Ollama, LM Studio) or a cloud. The settings name it; both shells
 * read it through `semanticSourceOf`, so they cannot disagree about it.
 */
import { AI_EMBEDDING_PROFILE, SEMANTIC_BY_PROVIDER, providerById, type AiAppSettings, type ProviderInfo } from "../registry.js";
import { embeddingModel, type EmbeddingModelSpec } from "./catalog.js";
import { embeddingRoute, providerEngineId, type EmbeddingRoute } from "./providerEngine.js";

export interface ProviderTarget {
  provider: ProviderInfo;
  model: string;
  /** Null where the provider's protocol has no embeddings (a hint the settings show). */
  route: EmbeddingRoute | null;
  /** The price the user entered for this model, US dollars per million tokens. */
  price?: { input: number; output: number };
}

export type SemanticSource =
  | { kind: "package"; key: string; spec: EmbeddingModelSpec }
  /** `target` is null while the profile "Embeddings" names no model (or a provider that was removed). */
  | { kind: "provider"; key: string; target: ProviderTarget | null };

/** The key of the profile "Embeddings" while it names no model. */
const UNSET_PROVIDER_KEY = "provider:";

/** What this device computes with, as the settings say; null while search by meaning is off (or the AI is). */
export function semanticSourceOf(settings: AiAppSettings): SemanticSource | null {
  if (!settings.enabled || !settings.semanticModel) return null;
  if (settings.semanticModel === SEMANTIC_BY_PROVIDER) {
    const choice = settings.profiles[AI_EMBEDDING_PROFILE];
    const provider = choice ? providerById(choice.providerId, settings.custom) : undefined;
    if (!choice || !provider) return { kind: "provider", key: UNSET_PROVIDER_KEY, target: null };
    const price = settings.prices[`${provider.id}/${choice.model}`];
    return {
      kind: "provider",
      key: providerEngineId(provider.id, choice.model),
      target: { provider, model: choice.model, route: embeddingRoute(provider.endpoint), ...(price ? { price } : {}) },
    };
  }
  const spec = embeddingModel(settings.semanticModel);
  return spec ? { kind: "package", key: spec.id, spec } : null;
}

/** A server on this computer: nothing leaves the device, so no standing approval is needed. */
export function isLocalTarget(target: ProviderTarget): boolean {
  return target.provider.kind === "local";
}
