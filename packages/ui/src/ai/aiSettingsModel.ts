import { BUILTIN_PROVIDERS, DEFAULT_AI_APP_SETTINGS, providerById, type AiAppSettings, type ModelFailure, type ProviderInfo } from "@plainva/core";
import { buildInfo, type BuildInfo } from "../lib/buildInfo";
import type { AiState, ProviderTest } from "./aiSession";

/**
 * What the settings show about the AI (plan KI-Harness §19.1, "KI & Automatisierung"),
 * derived once for both shells: the desktop page and the phone's screens only
 * draw it. Every provider is offered; hints explain, nothing is excluded.
 */

type T = (key: string, options?: Record<string, unknown>) => string;

/** Where feedback on the AI beta goes (plan KI-Harness P1.5): a new discussion, titled so it can be found. */
export const AI_FEEDBACK_URL = "https://github.com/plainva/plainva/discussions/new?category=general&title=AI%20beta%3A%20";

/**
 * The defaults of this build. A Labs build exists to test what is being
 * built (plan KI-Harness §21a.5), so it starts with the AI switched on; every
 * other build — the release above all — starts with it off. Either way the
 * switch stays the user's: a stored choice always wins over a default.
 */
export function aiDefaultSettings(info: BuildInfo = buildInfo()): AiAppSettings {
  return info.channel === "labs" ? { ...DEFAULT_AI_APP_SETTINGS, enabled: true } : DEFAULT_AI_APP_SETTINGS;
}

/** Why a system's model is not there (plan P2c), as the native plugins name it. */
const PLATFORM_REASONS: ReadonlySet<string> = new Set([
  "deviceNotEligible",
  "appleIntelligenceNotEnabled",
  "modelNotReady",
  "downloadable",
  "downloading",
  "notSupported",
  "osTooOld",
  "background",
  "unsupportedLanguage",
]);

/** A failure in words the reader can act on — the chat and the settings say it alike. */
export function aiFailureText(t: T, failure: ModelFailure, provider: string, model = ""): string {
  switch (failure.kind) {
    case "no_key":
      return t("ai.error.noKey", { provider });
    case "invalid_key":
      return t("ai.error.invalidKey", { provider });
    case "rate_limited":
      return t("ai.error.rateLimited", { provider });
    case "overloaded":
      return t("ai.error.overloaded", { provider });
    case "context_too_long":
      return t("ai.error.contextTooLong");
    case "not_found":
      return t("ai.error.notFound", { provider, model });
    case "refused_by_provider":
      return t("ai.error.refused", { provider, message: failure.message });
    case "unknown_endpoint":
      return t("ai.error.unknownEndpoint");
    case "offline":
      return t("ai.error.offline", { provider });
    case "stream_broken":
      return t("ai.error.streamBroken");
    case "provider_error":
      return t("ai.error.providerError", { provider, message: failure.message });
    case "platform_unavailable":
      return PLATFORM_REASONS.has(failure.reason) ? t(`ai.error.platform.${failure.reason}`, { provider }) : t("ai.error.platform.unavailable", { provider });
  }
}

export interface ProviderRowModel {
  provider: ProviderInfo;
  needsKey: boolean;
  hasKey: boolean;
  test?: ProviderTest;
}

/** The providers on the list: added ones, custom servers, and any with a key or a profile. */
export function configuredProviders(state: AiState): ProviderRowModel[] {
  const s = state.settings;
  const ids = new Set<string>([
    ...s.providers,
    ...Object.entries(state.keys).filter(([, has]) => has).map(([id]) => id),
    ...Object.values(s.profiles).flatMap((choice) => (choice ? [choice.providerId] : [])),
  ]);
  const builtin = BUILTIN_PROVIDERS.filter((p) => ids.has(p.id));
  const custom = s.custom.map((c) => providerById(c.id, s.custom)).filter((p): p is ProviderInfo => Boolean(p));
  return [...builtin, ...custom].map((provider) => ({
    provider,
    needsKey: provider.endpoint.needsKey,
    hasKey: Boolean(state.keys[provider.id]),
    test: state.tests[provider.id],
  }));
}

/** One status line per provider, in the reader's words. */
export function providerStatus(t: T, row: ProviderRowModel): string {
  const test = row.test;
  if (test?.state === "testing") return t("ai.settings.testing");
  if (row.provider.kind === "platform-device") {
    // The system's own model (plan P2c): ready with its window, or why it is not there.
    if (test?.state === "ok") return t("ai.settings.onDeviceReady", { tokens: test.models?.[0]?.contextTokens ?? row.provider.contextTokens ?? 0 });
    if (test?.state === "failed" && test.failure) return aiFailureText(t, test.failure, row.provider.label);
    return t("ai.settings.onDevice");
  }
  if (test?.state === "ok") return t("ai.settings.testOk", { count: test.models?.length ?? 0 });
  if (test?.state === "failed" && test.failure) return t("ai.settings.testFailed", { reason: aiFailureText(t, test.failure, row.provider.label) });
  if (!row.needsKey) return row.provider.kind === "local" ? t("ai.hint.local") : t("ai.settings.noKeyNeeded");
  return row.hasKey ? t("ai.settings.keyStored") : t("ai.settings.noKey");
}

export interface AddableGroups {
  cloud: ProviderInfo[];
  gateways: ProviderInfo[];
  /** Servers on this computer; the phone runs none (a parity decision, not a limit). */
  local: ProviderInfo[];
  /** The system's own model on this device (plan P2c): Apple on the iPhone, Gemini Nano on Android. */
  device: ProviderInfo[];
}

/** The providers that can still be added, grouped the way the dialog shows them. */
export function addableProviders(state: AiState, opts: { localServers: boolean; platformOs?: "ios" | "android" | null }): AddableGroups {
  const shown = new Set(configuredProviders(state).map((r) => r.provider.id));
  const free = BUILTIN_PROVIDERS.filter((p) => !shown.has(p.id));
  return {
    cloud: free.filter((p) => p.kind === "cloud"),
    gateways: free.filter((p) => p.kind === "gateway"),
    local: opts.localServers ? free.filter((p) => p.kind === "local") : [],
    device: free.filter((p) => p.kind === "platform-device" && p.os === opts.platformOs),
  };
}

/** Retention choices of the history (§16), in days; 0 keeps conversations until deleted. */
export const HISTORY_DAY_CHOICES = [30, 90, 365, 0] as const;
