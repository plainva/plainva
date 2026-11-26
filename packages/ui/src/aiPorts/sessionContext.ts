import { createContext, useContext, useSyncExternalStore } from "react";
import type { AiSession, AiState } from "../ai/aiSession";

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

/**
 * Whether the AI is on on this device (its per-device switch, once the
 * settings have loaded) — for a surface that only shows something while it
 * is (plan Oberfläche O7, D11: "Trust & provenance"). It re-renders on the
 * switch alone, not on every change of a conversation.
 */
export function useAiOn(session: AiSession | null): boolean {
  const on = () => Boolean(session && session.getState().loaded && session.getState().settings.enabled);
  return useSyncExternalStore(session ? session.subscribe : NOOP, on, on);
}
