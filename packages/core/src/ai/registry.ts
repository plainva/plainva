import { BUILTIN_ENDPOINTS, type ProviderApi, type ProviderEndpoint } from "./providers.js";

/**
 * The provider registry (§11.2, stages A and B): who can be chosen, where a
 * key comes from, and what the user should know first. Everything here is a
 * HINT, never a limit (principle 13): every provider is selectable, every
 * model id the provider accepts can be used, and Plainva recommends nothing as
 * "the best model".
 */

export type ProviderKind = "cloud" | "gateway" | "local";

export interface ProviderInfo {
  /** The endpoint id; also the key slot on the native side. */
  id: string;
  /** Brand name — never translated. */
  label: string;
  endpoint: ProviderEndpoint;
  kind: ProviderKind;
  /** Where to create a key (the "I don't have a key yet" flow, §11.4). */
  keyUrl?: string;
  /** The provider's own terms or data page, linked next to the hints. */
  termsUrl?: string;
  /** Locale keys of the hints shown with the provider. */
  hints: readonly string[];
  /** A user-added endpoint (OpenAI-compatible server or gateway). */
  custom?: boolean;
}

function endpoint(id: string): ProviderEndpoint {
  const found = BUILTIN_ENDPOINTS.find((e) => e.id === id);
  if (!found) throw new Error(`no built-in endpoint ${id}`);
  return found;
}

/** Stage A (native adapters) and stage B (breadth), in the order the settings list them. */
export const BUILTIN_PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    endpoint: endpoint("anthropic"),
    kind: "cloud",
    keyUrl: "https://console.anthropic.com/settings/keys",
    termsUrl: "https://www.anthropic.com/legal/commercial-terms",
    hints: ["ai.hint.anthropicRetention"],
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoint: endpoint("openai"),
    kind: "cloud",
    keyUrl: "https://platform.openai.com/api-keys",
    termsUrl: "https://openai.com/policies/business-terms/",
    hints: ["ai.hint.openaiStore"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    endpoint: endpoint("gemini"),
    kind: "cloud",
    keyUrl: "https://aistudio.google.com/apikey",
    termsUrl: "https://ai.google.dev/gemini-api/terms",
    hints: ["ai.hint.geminiFreeTier"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    endpoint: endpoint("openrouter"),
    kind: "gateway",
    keyUrl: "https://openrouter.ai/settings/keys",
    termsUrl: "https://openrouter.ai/terms",
    hints: ["ai.hint.gateway"],
  },
  {
    id: "ollama",
    label: "Ollama",
    endpoint: endpoint("ollama"),
    kind: "local",
    keyUrl: "https://ollama.com/download",
    hints: ["ai.hint.local"],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    endpoint: endpoint("lmstudio"),
    kind: "local",
    keyUrl: "https://lmstudio.ai/",
    hints: ["ai.hint.local"],
  },
];

/** A server the user added: OpenAI-compatible, key optional, confirmed natively. */
export interface CustomEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  api: Extract<ProviderApi, "openai-chat">;
  /** True when the server runs on this device (localhost). */
  local: boolean;
}

export const CUSTOM_ENDPOINT_PREFIX = "custom-";

export function customEndpointId(existing: readonly string[]): string {
  let n = 1;
  while (existing.includes(`${CUSTOM_ENDPOINT_PREFIX}${n}`)) n++;
  return `${CUSTOM_ENDPOINT_PREFIX}${n}`;
}

/** Normalises what a user typed as a server address; null when it is not one. */
export function normalizeBaseUrl(raw: string): { baseUrl: string; local: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  // Plain http leaves the device readable by anyone on the way: only for a server on this device.
  if (url.protocol === "http:" && !local) return null;
  let path = url.pathname;
  while (path.endsWith("/")) path = path.slice(0, -1);
  return { baseUrl: `${url.protocol}//${url.host.toLowerCase()}${path}`, local };
}

export function customProvider(custom: CustomEndpoint): ProviderInfo {
  return {
    id: custom.id,
    label: custom.label,
    endpoint: { id: custom.id, api: custom.api, baseUrl: custom.baseUrl, needsKey: false },
    kind: custom.local ? "local" : "gateway",
    hints: [custom.local ? "ai.hint.local" : "ai.hint.customServer"],
    custom: true,
  };
}

export function allProviders(custom: readonly CustomEndpoint[]): ProviderInfo[] {
  return [...BUILTIN_PROVIDERS, ...custom.map(customProvider)];
}

export function providerById(id: string, custom: readonly CustomEndpoint[]): ProviderInfo | undefined {
  return allProviders(custom).find((p) => p.id === id);
}

/** Profiles (§11.3): named slots the user fills — data, not a recommendation. */
export type AiProfileId = "fast" | "balanced" | "strong" | "local";
export const AI_PROFILE_IDS: readonly AiProfileId[] = ["fast", "balanced", "strong", "local"];

export interface ModelChoice {
  providerId: string;
  model: string;
}

export interface AiAppSettings {
  /** The per-device switch; off in public builds until the beta (§21a.8). */
  enabled: boolean;
  /** Built-in providers the user added to the list (custom servers are in `custom`). */
  providers: string[];
  profiles: Partial<Record<AiProfileId, ModelChoice>>;
  defaultProfile: AiProfileId;
  custom: CustomEndpoint[];
  /** Days a conversation is kept after its last message; 0 keeps it. */
  historyDays: number;
  /** Prices the user entered, US dollars per million tokens, by `provider/model`. */
  prices: Record<string, { input: number; output: number }>;
  /**
   * Show the send overview before every request, not only when the approved
   * scope grows (plan §13.3, for the strict ones).
   */
  confirmEveryRequest: boolean;
  /**
   * Let AI apps on this computer read the vault through Plainva's MCP server
   * (plan §17.3; desktop only). Off: nothing listens, not even locally.
   */
  mcpEnabled: boolean;
}

export const DEFAULT_AI_APP_SETTINGS: AiAppSettings = {
  enabled: false,
  providers: [],
  profiles: {},
  defaultProfile: "balanced",
  custom: [],
  historyDays: 90,
  prices: {},
  confirmEveryRequest: false,
  mcpEnabled: false,
};

/** Reads stored settings defensively: a damaged value falls back field by field. */
export function readAiAppSettings(raw: unknown, defaults: AiAppSettings = DEFAULT_AI_APP_SETTINGS): AiAppSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profiles: Partial<Record<AiProfileId, ModelChoice>> = {};
  const rawProfiles = value.profiles && typeof value.profiles === "object" ? (value.profiles as Record<string, unknown>) : {};
  for (const id of AI_PROFILE_IDS) {
    const choice = rawProfiles[id] as Partial<ModelChoice> | undefined;
    if (choice && typeof choice.providerId === "string" && typeof choice.model === "string" && choice.model.trim()) {
      profiles[id] = { providerId: choice.providerId, model: choice.model.trim() };
    }
  }
  const custom = Array.isArray(value.custom)
    ? value.custom.filter(
        (c): c is CustomEndpoint =>
          Boolean(c) &&
          typeof c === "object" &&
          typeof (c as CustomEndpoint).id === "string" &&
          (c as CustomEndpoint).id.startsWith(CUSTOM_ENDPOINT_PREFIX) &&
          typeof (c as CustomEndpoint).label === "string" &&
          typeof (c as CustomEndpoint).baseUrl === "string" &&
          normalizeBaseUrl((c as CustomEndpoint).baseUrl) !== null,
      ).map((c) => ({ ...c, api: "openai-chat" as const, local: normalizeBaseUrl(c.baseUrl)!.local }))
    : defaults.custom;
  const prices: Record<string, { input: number; output: number }> = {};
  const rawPrices = value.prices && typeof value.prices === "object" ? (value.prices as Record<string, unknown>) : {};
  for (const [key, price] of Object.entries(rawPrices)) {
    const p = price as { input?: unknown; output?: unknown };
    if (typeof p?.input === "number" && typeof p.output === "number" && p.input >= 0 && p.output >= 0) prices[key] = { input: p.input, output: p.output };
  }
  const historyDays = typeof value.historyDays === "number" && Number.isInteger(value.historyDays) && value.historyDays >= 0 ? value.historyDays : defaults.historyDays;
  const defaultProfile = AI_PROFILE_IDS.includes(value.defaultProfile as AiProfileId) ? (value.defaultProfile as AiProfileId) : defaults.defaultProfile;
  const known = new Set(BUILTIN_PROVIDERS.map((p) => p.id));
  const providers = Array.isArray(value.providers)
    ? [...new Set(value.providers.filter((id): id is string => typeof id === "string" && known.has(id)))]
    : defaults.providers;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    providers,
    profiles,
    defaultProfile,
    custom,
    historyDays,
    prices,
    confirmEveryRequest: typeof value.confirmEveryRequest === "boolean" ? value.confirmEveryRequest : defaults.confirmEveryRequest,
    mcpEnabled: typeof value.mcpEnabled === "boolean" ? value.mcpEnabled : defaults.mcpEnabled,
  };
}

/** The model a new conversation starts with: the default profile, else the first filled one. */
export function initialModelChoice(settings: AiAppSettings): ModelChoice | null {
  return settings.profiles[settings.defaultProfile] ?? AI_PROFILE_IDS.map((id) => settings.profiles[id]).find(Boolean) ?? null;
}
