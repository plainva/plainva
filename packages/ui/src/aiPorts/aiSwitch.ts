import { buildInfo, type BuildInfo } from "../lib/buildInfo";

/**
 * The AI's switch on this device, read without the harness (performance plan L5): the shell looks at it at the start
 * and loads the AI only when it is on. The rule is the harness's own (`readAiAppSettings` and `aiDefaultSettings`):
 * a stored `enabled` of true or false counts, anything else falls back to the default of the build — on in a Labs
 * build, off everywhere else. A test holds the two readings together.
 */

/** Where both shells keep the AI's settings in the app's settings store. */
export const AI_SETTINGS_KEY = "ai";

/** Whether the AI is on by default in this build. */
export function aiSwitchDefault(info: BuildInfo = buildInfo()): boolean {
  return info.channel === "labs";
}

/** Whether the stored AI settings switch the AI on, with the build's default where they say nothing. */
export function aiSwitchOf(stored: unknown, fallback: boolean = aiSwitchDefault()): boolean {
  const value = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return typeof value.enabled === "boolean" ? value.enabled : fallback;
}
