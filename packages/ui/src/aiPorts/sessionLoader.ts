import { useSyncExternalStore } from "react";
import type { AiSession } from "../ai/aiSession";
import { loadAiModule } from "./aiModule";

/**
 * A shell's AI session, made on demand (performance plan L5). The shell hands over how it makes its session — a
 * dynamic import of its own AI module and the call that builds the session there —; the loader makes it once, the
 * first time it is asked for: at the start when the AI is on on this device, or when a surface of the AI opens (the
 * AI's settings, its tab). Until then every reader sees `null`, which is what a window without the AI sees, and
 * draws nothing of the AI.
 */
export interface AiSessionLoader {
  /** Makes the session (once) and answers with it; `null` where this window has none. A failed load may be asked again. */
  ensure(): Promise<AiSession | null>;
  /** The session when it is made, else `null`. */
  session(): AiSession | null;
  /** Whether the session was asked for: the shell mounts the AI's own surfaces from then on. */
  requested(): boolean;
  /**
   * Takes a session the shell made itself (a surface of the AI that asks the shell's module directly). Readers learn
   * of it after the current render, never during it.
   */
  adopt(made: AiSession | null): void;
  subscribe(listener: () => void): () => void;
}

export function createAiSessionLoader(make: () => Promise<AiSession | null>): AiSessionLoader {
  let session: AiSession | null = null;
  let pending: Promise<AiSession | null> | null = null;
  let asked = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    ensure() {
      if (!asked) {
        asked = true;
        emit();
      }
      pending ??= Promise.all([make(), loadAiModule()]).then(
        ([made]) => {
          session = made;
          emit();
          return made;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    adopt(made) {
      if (session === made && asked) return;
      asked = true;
      session = made;
      pending ??= loadAiModule().then(() => made);
      void loadAiModule().then(() => queueMicrotask(emit), () => undefined);
    },
    session: () => session,
    requested: () => asked,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The loader's session for a component: `null` until it is made. */
export function useLoadedAiSession(loader: AiSessionLoader): AiSession | null {
  return useSyncExternalStore(loader.subscribe, loader.session, loader.session);
}

/** Whether the loader was asked for its session. */
export function useAiRequested(loader: AiSessionLoader): boolean {
  return useSyncExternalStore(loader.subscribe, loader.requested, loader.requested);
}

/**
 * At the start: reads the switch (`readSwitch`, without the harness) and makes the session only when the AI is on.
 * A switch that cannot be read counts as off; a surface of the AI still makes the session when it opens.
 */
export async function ensureAiIfOn(loader: AiSessionLoader, readSwitch: () => Promise<boolean>): Promise<AiSession | null> {
  let on: boolean;
  try {
    on = await readSwitch();
  } catch {
    on = false;
  }
  return on ? loader.ensure() : null;
}
