import { useSyncExternalStore } from "react";
import type { AiSession, AiState } from "./aiSession";
import { openWritesCount, useOpenProposals } from "./AiWriteCards";
import { waitingCount } from "./skillsWorkshop";

const NOOP = () => () => {};
const NONE = (): AiState | null => null;

/**
 * How many things wait for the user's decision (plan KI-Oberflächen K11): the
 * drafts and open proposals of the AI ("To decide"), and the skills waiting for
 * an approval on this device. The AI's entry in both shells — the desktop's
 * ribbon button, the phone's area and bar — carries the number, so nobody has
 * to open the AI to learn that something asks of them. Nothing while the AI is
 * off on this device.
 */
export function useAiWaitingCount(session: AiSession | null): number {
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  // Read again whenever the vault or the switch changes: the entry lives as long as the app.
  const proposals = useOpenProposals(session && state?.settings.enabled ? session : null, `${state?.hasVault}:${state?.summaries.length}`);
  if (!state || !state.loaded || !state.settings.enabled) return 0;
  return openWritesCount(state.drafts, proposals) + waitingCount(state.skills.entries);
}
