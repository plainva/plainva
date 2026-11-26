import type { AiProfileSlot } from "@plainva/core/ai";

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
