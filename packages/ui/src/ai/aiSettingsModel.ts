import { BUILTIN_PROVIDERS, DEFAULT_AI_APP_SETTINGS, failureClassOf, providerById, runsOnDevice, type AiAppSettings, type ModelFailure, type ProviderInfo } from "@plainva/core/ai";
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
const PLATFORM_REASON_LIST = [
  "deviceNotEligible",
  "appleIntelligenceNotEnabled",
  "modelNotReady",
  "downloadable",
  "downloading",
  "notSupported",
  "osTooOld",
  "background",
  "unsupportedLanguage",
] as const;
/** A reason the native plugins name: the domain of `ai.error.platform.<reason>` (F53 of release 0.9.0). */
type PlatformReason = (typeof PLATFORM_REASON_LIST)[number];
const isPlatformReason = (reason: string): reason is PlatformReason => (PLATFORM_REASON_LIST as readonly string[]).includes(reason);

/**
 * Who a failure is about: its name, and whether it is this device. A server on
 * this computer that does not answer is not "unreachable" — it is not running,
 * or its model is too large (plan KI-Harness P7).
 */
export interface FailureRecipient {
  label: string;
  here?: boolean;
}

/** A provider as the one a failure is about. */
export function failureRecipient(provider: Pick<ProviderInfo, "label" | "kind">): FailureRecipient {
  return { label: provider.label, here: runsOnDevice(provider) };
}

/** A failure in words the reader can act on — the chat and the settings say it alike. */
export function aiFailureText(t: T, failure: ModelFailure, recipient: string | FailureRecipient, model = "", how: { sent?: string } = {}): string {
  const provider = typeof recipient === "string" ? recipient : recipient.label;
  const here = typeof recipient !== "string" && recipient.here === true;
  // The sentence about sending stands apart from reason and remedy (review B7-2): "nothing was sent" where nothing of
  // this request left the device, another sentence (or none) where something did. Spaces closed up where it is empty.
  const sent = how.sent ?? t("ai.error.nothingSent");
  const said = (text: string) => text.replace(/\s{2,}/g, " ").trim();
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
    case "unreachable":
      // The device knows when it has no network at all: then that is said, not the provider blamed (plan KI-Oberflächen K10).
      if (!here && deviceOffline()) return t("ai.error.deviceOffline");
      return here ? t("ai.error.offlineHere", { provider }) : t("ai.error.offline", { provider });
    case "stream_broken":
      return here ? t("ai.error.streamBrokenHere", { provider }) : t("ai.error.streamBroken");
    case "certificate":
      // The words the sync already says for the same certificate (F72).
      return t(`connectionFailure.${failure.code}`);
    case "provider_error":
      return t("ai.error.providerError", { provider, message: failure.message });
    case "platform_unavailable":
      return isPlatformReason(failure.reason) ? t(`ai.error.platform.${failure.reason}`, { provider }) : t("ai.error.platform.unavailable", { provider });
    case "kept_on_device":
      return t("ai.error.keptOnDevice", { provider });
    case "local_only":
      return said(t("ai.error.localOnly", { provider, sent }));
    case "window_too_small":
      return said(t("ai.error.windowTooSmall", { needed: failure.needed, window: failure.window, model, sent }));
    case "too_large":
      return said(t("ai.error.tooLarge", { sent }));
    case "invalid_request":
      return said(t("ai.error.invalidRequest", { sent }));
  }
}

/**
 * A failure as the conversation says it (plan Umsetzung 0.9.x, B7; M9), by its class. "Nothing was sent" and "your
 * question is back in the field" stand only over a request of the first class whose question went back (`returned`);
 * a request that may have arrived says so. `images`: the pictures of the turn that failed.
 */
export function conversationFailureText(t: T, failure: ModelFailure, recipient: FailureRecipient, model: string, how: { returned?: boolean; images?: number; departedTo?: readonly string[]; locale?: string } = {}): string {
  const provider = recipient.label;
  // The model call never went, but the run handed something on before it (B7, review S1: the question embedded for
  // the search at a cloud model, a foreign server's prompt): the reason and its remedy stand, and the sentence about
  // sending names whom it went to — never "nothing was sent".
  if (how.departedTo?.length && failureClassOf(failure) === "never_sent" && SAYS_NOTHING_SENT.has(failure.kind)) return aiFailureText(t, failure, recipient, model, { sent: alreadySentText(t, how.departedTo, how.locale) });
  if (failure.kind === "unreachable" && how.returned) return t("ai.error.unreachable", { provider });
  // No answer, or one that broke off, from a provider elsewhere: the request may have arrived. A server on this device
  // and a device without any network keep their own words.
  if ((failure.kind === "offline" || failure.kind === "stream_broken") && !recipient.here && !deviceOffline()) return t("ai.error.noAnswer", { provider });
  // The provider said "too large" of a turn with pictures: mostly one of them.
  if (failure.kind === "context_too_long" && (how.images ?? 0) > 0) return `${aiFailureText(t, failure, recipient, model)} ${t("ai.error.imageTooBig")}`;
  return aiFailureText(t, failure, recipient, model);
}

/**
 * The sentence about sending where something of the request already left the device (B7, approved 27.11.): "Already
 * sent to: …. Nothing more was sent." `recipients` are names as a person reads them (`departureNames`).
 */
export function alreadySentText(t: T, recipients: readonly string[], locale = "en"): string {
  return t("ai.error.alreadySent", { recipients: namesListed([...new Set(recipients)], locale) });
}

/**
 * Whom a run's list of departures names (`departedTo`: endpoint ids, `mcp:<server id>`, `web`, `mail`), as a person
 * reads them: a provider by its label, a server by its name, the web page and the mail server in words of their own.
 */
export function departureNames(t: T, entries: readonly string[], names: { provider: (id: string) => string; server: (id: string) => string }): string[] {
  const out = entries.map((entry) =>
    entry === "web" ? t("ai.error.recipient.web") : entry === "mail" ? t("ai.error.recipient.mail") : entry.startsWith("mcp:") ? names.server(entry.slice(4)) : names.provider(entry),
  );
  return [...new Set(out)];
}

/** "A, B and C" in the language's own list form; a comma list where the engine has no `Intl.ListFormat`. */
export function namesListed(names: readonly string[], locale: string): string {
  type ListFormatter = new (locale: string, options: { style: "long"; type: "conjunction" }) => { format(list: readonly string[]): string };
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatter }).ListFormat;
  try {
    if (ListFormat) return new ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  } catch {
    /* an unknown locale: fall through */
  }
  return names.join(", ");
}

/** The failures whose words say that nothing was sent (`ai.error.*`, the sentence `{{sent}}`). */
const SAYS_NOTHING_SENT: ReadonlySet<ModelFailure["kind"]> = new Set<ModelFailure["kind"]>(["too_large", "invalid_request", "window_too_small", "local_only"]);

/** Whether this device has no network at all, as far as the browser knows. */
function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Who a failure comes from, as the notice names it (plan KI-Oberflächen K10): this device, the network, the provider, or Plainva. */
export type FailureSender = "device" | "network" | "provider" | "plainva";

export function failureSender(failure: ModelFailure, recipient: FailureRecipient): FailureSender {
  switch (failure.kind) {
    case "no_key":
    case "unknown_endpoint":
    case "platform_unavailable":
    case "too_large":
      return "device";
    case "offline":
      if (recipient.here) return "device";
      return deviceOffline() ? "network" : "provider";
    case "stream_broken":
      return recipient.here ? "device" : "network";
    // No connection ever stood (B7): the way there, or this device's own server.
    case "unreachable":
    case "certificate":
      return recipient.here ? "device" : "network";
    case "invalid_key":
    case "rate_limited":
    case "overloaded":
    case "context_too_long":
    case "not_found":
    case "refused_by_provider":
    case "provider_error":
      return recipient.here ? "device" : "provider";
    default:
      return "plainva";
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
    if (test?.state === "failed" && test.failure) return aiFailureText(t, test.failure, failureRecipient(row.provider));
    return t("ai.settings.onDevice");
  }
  if (test?.state === "ok") return t("ai.settings.testOk", { count: test.models?.length ?? 0 });
  if (test?.state === "failed" && test.failure) return t("ai.settings.testFailed", { reason: aiFailureText(t, test.failure, failureRecipient(row.provider)) });
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
