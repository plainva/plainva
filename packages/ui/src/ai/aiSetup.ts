import { BUILTIN_PROVIDERS, type AiProfileSlot, type ProviderInfo } from "@plainva/core";
import { configuredProviders } from "./aiSettingsModel";
import type { AiState } from "./aiSession";

/**
 * The one way from the switch to the first answer (plan KI-Oberflächen K3):
 * which step is still missing on this device. Both shells draw the same
 * setup card from it, in place of the mode line, until a conversation can
 * start.
 *
 * - `provider`: no provider is set up yet.
 * - `model`: a provider is there, but the profile new conversations start
 *   with names no model.
 * - `null`: a conversation can start.
 */
export type AiSetupStep = "provider" | "model" | null;

export function aiSetupStep(state: Pick<AiState, "settings" | "keys" | "tests">): AiSetupStep {
  if (configuredProviders(state as AiState).length === 0) return "provider";
  return state.settings.profiles[state.settings.defaultProfile] ? null : "model";
}

/**
 * Where an AI notice or the setup card sends the user in the settings (plan
 * KI-Oberflächen K3, K10): not just "the settings", but the dialog that fixes
 * it — the key of one provider, the model of one profile. The conversation
 * sets it right before it opens the settings; the AI settings page of either
 * shell takes it once when it shows.
 */
export type AiSettingsIntent = { kind: "key"; providerId: string } | { kind: "model"; profile: AiProfileSlot };

let pendingIntent: AiSettingsIntent | null = null;

export function requestAiSettingsIntent(intent: AiSettingsIntent): void {
  pendingIntent = intent;
}

export function takeAiSettingsIntent(): AiSettingsIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

/**
 * The setup in three steps (plan Oberfläche O7, T9; mockup M7): what does the
 * AI compute with (1), the way in — a key, the device's own model, an
 * address (2) —, and a first "Hello" that ends in the conversation (3). The
 * phone draws it as one sheet; this is what the sheet offers and where it
 * starts, decided once so a test can hold it.
 */
export type AiSetupKind = "device" | "cloud" | "server";

export interface AiSetupOffer {
  /** The three answers to "What should the AI compute with?", in this order; "device" only where the system has a model. */
  kinds: AiSetupKind[];
  /** The system's own model, where this device has one. */
  device: ProviderInfo | null;
  /** The providers that take a key of the user's own: the clouds first, then the gateways. */
  cloud: ProviderInfo[];
}

export function aiSetupOffer(state: Pick<AiState, "settings" | "keys" | "tests">, platformOs: "ios" | "android" | null): AiSetupOffer {
  const configured = configuredProviders(state as AiState).map((row) => row.provider);
  const device =
    configured.find((p) => p.kind === "platform-device") ?? BUILTIN_PROVIDERS.find((p) => p.kind === "platform-device" && p.os === platformOs) ?? null;
  const cloud = [...BUILTIN_PROVIDERS.filter((p) => p.kind === "cloud"), ...BUILTIN_PROVIDERS.filter((p) => p.kind === "gateway")];
  return { kinds: [...(device ? (["device"] as const) : []), "cloud", "server"], device, cloud };
}

/**
 * Where the setup begins: at step 1 while no provider is set up; at step 3 —
 * the model and the first "Hello" — once one is there that can answer but the
 * profile new conversations start with names no model (`aiSetupStep`
 * "model"), with that provider chosen. A provider that is set up but cannot
 * answer — its key is missing, its last test failed — begins at step 2 with
 * that provider, so it can be fixed or replaced there (review O7, O2): the
 * setup never begins behind a step that has to be done again.
 */
export function aiSetupStart(state: Pick<AiState, "settings" | "keys" | "tests">): { step: 1 | 2 | 3; providerId: string | null } {
  if (aiSetupStep(state) !== "model") return { step: 1, providerId: null };
  const rows = configuredProviders(state as AiState);
  const ready = rows.find((row) => (!row.needsKey || row.hasKey) && state.tests[row.provider.id]?.state !== "failed");
  if (ready) return { step: 3, providerId: ready.provider.id };
  return { step: rows.length ? 2 : 1, providerId: rows[0]?.provider.id ?? null };
}
