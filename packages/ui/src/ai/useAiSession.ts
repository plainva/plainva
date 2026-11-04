import { createContext, useContext, useSyncExternalStore } from "react";
import type { AiSession, AiState } from "./aiSession";

/**
 * The one AI session of a window, handed down by the shell. Surfaces read it
 * through `useAiState`; a window without AI (an auxiliary window) provides
 * none, and the surfaces render nothing there.
 */
export const AiSessionContext = createContext<AiSession | null>(null);

export function useAiSession(): AiSession | null {
  return useContext(AiSessionContext);
}

const EMPTY = (): null => null;
const NOOP = () => () => {};

/** The session's state, re-rendering on every change; null without a session. */
export function useAiState(): AiState | null {
  const session = useAiSession();
  return useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : EMPTY, session ? session.getState : EMPTY);
}
