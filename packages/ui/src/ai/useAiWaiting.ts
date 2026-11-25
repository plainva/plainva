import { useSyncExternalStore } from "react";
import type { AiSession, AiState } from "./aiSession";
import { openWritesCount, useOpenProposals } from "./AiWriteCards";
import { waitingCount } from "./skillsWorkshop";

const NOOP = () => () => {};
const NONE = (): AiState | null => null;

/**
 * How many things wait for the user's decision (plan KI-Oberflächen K11): the drafts and open proposals of the AI —
 * exactly what the segment "To decide" lists (F71 of release 0.9.0, mockup M10). The AI's entry in both shells — the
 * desktop's ribbon button, the phone's area and bar, the phone's start page — carries this number, so nobody has to
 * open the AI to learn that something asks of them, and the number never leads to a list that shows less. Skills
 * waiting for an approval have their own number at the segment "Skills" (mockup M11); they and a question the running
 * conversation asks are `useAiAttention`. Nothing while the AI is off on this device.
 */
export function useAiWaitingCount(session: AiSession | null): number {
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  // Read again whenever the vault or the switch changes: the entry lives as long as the app.
  // The vault's own count (`vaultEpoch`), not only its conversations: two
  // vaults with none had the same key, and the old vault's number stayed.
  const proposals = useOpenProposals(session && state?.settings.enabled ? session : null, `${state?.vaultEpoch}:${state?.hasVault}:${state?.summaries.length}`);
  if (!state || !state.loaded || !state.settings.enabled) return 0;
  return openWritesCount(state.drafts, proposals);
}

/**
 * Whether something of the AI asks for a look that the number does not count (review O7, R3; F71 of release 0.9.0):
 * a question the running conversation asks — its send overview, a page or a call to allow, a server's question; put
 * away with the column, it is still open — or a skill waiting for an approval on this device. The AI's entry in both
 * shells shows a dot for it, without a number, and says that something waits; where a number stands, the number stays.
 */
export function useAiAttention(session: AiSession | null): boolean {
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  if (!state || !state.loaded || !state.settings.enabled) return false;
  return Boolean(state.consent || state.effect || state.question) || waitingCount(state.skills.entries) > 0;
}
