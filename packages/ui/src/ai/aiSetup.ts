import type { AiProfileSlot } from "@plainva/core";
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
