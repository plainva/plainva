import {
  AI_AUDIO_PROFILE,
  AI_EMBEDDING_PROFILE,
  AI_PROFILE_IDS,
  MODEL_WINDOW_MAX,
  MODEL_WINDOW_MIN,
  SEMANTIC_BY_PROVIDER,
  choiceOnDevice,
  deviceHelpers,
  isModelWindow,
  modeAnswerer,
  operatingMode,
  providerById,
  runsOnDevice,
  type AiAppSettings,
  type AiProfileSlot,
  type ModelChoice,
  type OperatingMode,
  type ProviderInfo,
} from "@plainva/core";
import type { AiState } from "./aiSession";
import { configuredProviders } from "./aiSettingsModel";

/**
 * The mode a device is in, as the settings say it (plan KI-Harness P7, ADR
 * 0030, mockup chapter 23), derived once for both shells: one line that says
 * what holds now, the switch "Fully local", and — while it is on — what of
 * the user's own set-up rests. The desktop's card and the phone's group only
 * draw it.
 *
 * Cloud and Hybrid are no choice: they are what the user's providers and
 * helpers amount to. Only "Fully local" is a switch, because only it
 * promises something.
 */

type T = (key: string, options?: Record<string, unknown>) => string;

/** What can rest while a device is fully local, in the order the card lists it. */
export type RestingKind = "providers" | "web" | "mcp" | "agents" | "apps" | "search" | "system";

export interface ModeRest {
  kind: RestingKind;
  /** The thing by its name in the settings. */
  label: string;
  /** What resting means for it. */
  desc: string;
}

export interface ModeFacts {
  mode: OperatingMode;
  localOnly: boolean;
  /** Fully local, and no profile names a model on this device: the card offers the way to set one up. */
  empty: boolean;
  title: string;
  body: string;
  /** What rests while the device is fully local — only what is set up; empty while the switch is off. */
  rests: ModeRest[];
}

/** "A, B and C" in the language's own list form. */
function listAll(names: readonly string[], locale: string): string {
  // `Intl.ListFormat` is newer than the library target this package compiles
  // against, and older WebViews may lack it; a comma list is the fallback.
  type ListFormatter = new (locale: string, options: { style: "long"; type: "conjunction" }) => { format(list: readonly string[]): string };
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatter }).ListFormat;
  try {
    if (ListFormat) return new ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  } catch {
    /* an unknown locale: fall through */
  }
  return names.join(", ");
}

const labelOf = (settings: AiAppSettings, providerId: string) => providerById(providerId, settings.custom)?.label ?? providerId;

/** The profiles that answer a person — the chat profiles and "Audio" — whose model is not on this device. */
function restingProfiles(settings: AiAppSettings): AiProfileSlot[] {
  return ([...AI_PROFILE_IDS, AI_AUDIO_PROFILE] as AiProfileSlot[]).filter((slot) => {
    const choice = settings.profiles[slot];
    return Boolean(choice) && !choiceOnDevice(settings, choice);
  });
}

/** Search by meaning rests: the device is fully local, and it computes with a provider that is not this device. */
export function searchRests(settings: AiAppSettings): boolean {
  const embedding = settings.profiles[AI_EMBEDDING_PROFILE];
  return settings.localOnly && settings.semanticModel === SEMANTIC_BY_PROVIDER && Boolean(embedding) && !choiceOnDevice(settings, embedding);
}

function restsOf(t: T, state: AiState, locale: string): ModeRest[] {
  const s = state.settings;
  const rests: ModeRest[] = [];
  const away = configuredProviders(state).filter((row) => !runsOnDevice(row.provider));
  if (away.length) {
    const slots = restingProfiles(s);
    const profiles = slots.length ? ` ${t("ai.mode.rests.profiles", { count: slots.length, profiles: listAll(slots.map((slot) => t(`ai.profile.${slot}`)), locale) })}` : "";
    rests.push({ kind: "providers", label: listAll(away.map((row) => row.provider.label), locale), desc: `${t("ai.mode.rests.providers", { count: away.length })}${profiles}` });
  }
  if (state.web.enabled) rests.push({ kind: "web", label: t("ai.web.settings.title"), desc: t("ai.mode.rests.web") });
  if (state.mcp.available && state.mcp.servers.length) rests.push({ kind: "mcp", label: t("ai.ext.title"), desc: t("ai.mode.rests.mcp") });
  if (state.agents.available && state.agents.agents.length) rests.push({ kind: "agents", label: t("ai.agent.title"), desc: t("ai.mode.rests.agents") });
  if (s.mcpEnabled) rests.push({ kind: "apps", label: t("ai.mcp.title"), desc: t("ai.mode.rests.apps") });
  const embedding = s.profiles[AI_EMBEDDING_PROFILE];
  if (embedding && searchRests(s)) rests.push({ kind: "search", label: t("ai.semantic.title"), desc: t("ai.mode.rests.search", { provider: labelOf(s, embedding.providerId) }) });
  if (s.systemFind) rests.push({ kind: "system", label: t("ai.system.title"), desc: t("ai.mode.rests.system") });
  return rests;
}

/** What the mode card shows: the state line, and what rests while the device is fully local. */
export function modeFacts(t: T, state: AiState, locale: string): ModeFacts {
  const s = state.settings;
  const mode = operatingMode(s);
  const answerer = modeAnswerer(s);
  const who = answerer ? { provider: labelOf(s, answerer.choice.providerId), model: answerer.choice.model } : { provider: "", model: "" };
  const facts = (title: string, body: string): ModeFacts => ({ mode, localOnly: s.localOnly, empty: mode === "local" && !answerer, title, body, rests: s.localOnly ? restsOf(t, state, locale) : [] });
  switch (mode) {
    case "none":
      return facts(t("ai.mode.now.none"), t("ai.mode.now.noneBody"));
    case "cloud":
      return facts(t("ai.mode.now.cloud"), t("ai.mode.now.cloudBody", who));
    case "hybrid": {
      const helpers = deviceHelpers(s).map((helper) => t(`ai.mode.helper.${helper}`, { model: s.profiles.local?.model ?? "" }));
      return facts(t("ai.mode.now.hybrid"), t("ai.mode.now.hybridBody", { ...who, helpers: listAll(helpers, locale) }));
    }
    case "device":
      return facts(t("ai.mode.now.device"), t("ai.mode.now.deviceBody", who));
    case "local":
      return answerer
        ? facts(t("ai.mode.now.local"), t("ai.mode.now.localBody", { ...who, profile: t(`ai.profile.${answerer.profile}`) }))
        : facts(t("ai.mode.now.localEmpty"), t("ai.mode.now.localEmptyBody"));
  }
}

/** A model whose window and tools its user states: one on a server on this device. The system's own model says both itself. */
export function describesItself(provider: Pick<ProviderInfo, "kind"> | null | undefined): boolean {
  return provider?.kind !== "local";
}

/** What a profile's line adds about a model on this device: its stated window, and that it takes no tools. */
export function profileFacts(t: T, choice: ModelChoice | undefined, format: (value: number) => string): string[] {
  if (!choice) return [];
  return [...(choice.contextTokens ? [t("ai.settings.profileWindow", { tokens: format(choice.contextTokens) })] : []), ...(choice.tools === false ? [t("ai.settings.profileNoTools")] : [])];
}

/** What was typed as a window: a number to keep, nothing (unknown), or not a window at all. */
export function readStatedWindow(typed: string): { ok: true; value: number | undefined } | { ok: false } {
  const text = typed.trim();
  if (!text) return { ok: true, value: undefined };
  // Digits, or digits grouped in threes the way people type them: "8192", "8 192", "8.192", "8,192". A window is a
  // whole number of tokens — "4096.0" is not read as forty thousand.
  if (!/^(\d+|\d{1,3}(?:[\s.,']\d{3})+)$/.test(text)) return { ok: false };
  const value = Number(text.replace(/[\s.,']/g, ""));
  return isModelWindow(value) ? { ok: true, value } : { ok: false };
}

/** The bounds a stated window has to keep, for the hint that says so. */
export const STATED_WINDOW_BOUNDS = { min: MODEL_WINDOW_MIN, max: MODEL_WINDOW_MAX } as const;

/** A choice of model with what its user said about it — only for a model that does not describe itself. */
export function statedChoice(provider: Pick<ProviderInfo, "kind"> | null | undefined, choice: { providerId: string; model: string }, said: { window: number | undefined; tools: boolean }): ModelChoice {
  if (describesItself(provider)) return { providerId: choice.providerId, model: choice.model };
  return { providerId: choice.providerId, model: choice.model, ...(said.window ? { contextTokens: said.window } : {}), ...(said.tools ? {} : { tools: false }) };
}
