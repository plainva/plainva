import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { LocalEmbeddings, LocalEmbeddingsState } from "../ai/localEmbeddings";
import type { LocalGists, LocalGistsState } from "../ai/localGists";

/*
 * What the models on this device do for the open vault — search by meaning and gists — as every surface of a window
 * reads it. The controllers are made by the AI harness; these contexts only carry them, so a surface of the start
 * bundle can ask without loading the harness (performance plan L5).
 */

/** The vault's search by meaning, for every surface of the window. */
export const LocalEmbeddingsContext = createContext<LocalEmbeddings | null>(null);

const NOOP_SUBSCRIBE = () => () => undefined;
const NO_STATE = (): LocalEmbeddingsState | null => null;

export function useLocalEmbeddings(): { controller: LocalEmbeddings | null; state: LocalEmbeddingsState | null } {
  const controller = useContext(LocalEmbeddingsContext);
  const state = useSyncExternalStore(controller ? controller.subscribe : NOOP_SUBSCRIBE, controller ? controller.snapshot : NO_STATE, controller ? controller.snapshot : NO_STATE);
  return { controller, state };
}

/** Whether search by meaning takes part right now: a model is open and passed the device check. */
export function meaningActive(state: LocalEmbeddingsState | null): boolean {
  return state?.engine.kind === "ready";
}

/** The vault's gists (plan KI-Harness P2b-3), for the settings of both shells. */
export const LocalGistsContext = createContext<LocalGists | null>(null);

const NO_GISTS = (): LocalGistsState | null => null;

export function useLocalGists(): { controller: LocalGists | null; state: LocalGistsState | null } {
  const controller = useContext(LocalGistsContext);
  const state = useSyncExternalStore(controller ? controller.subscribe : NOOP_SUBSCRIBE, controller ? controller.snapshot : NO_GISTS, controller ? controller.snapshot : NO_GISTS);
  return { controller, state };
}

/** What the models on this device do for the open vault — search by meaning and gists — for every surface of the window. */
export function LocalModelsProvider({ embeddings, gists, children }: { embeddings: LocalEmbeddings | null; gists: LocalGists | null; children: ReactNode }) {
  return (
    <LocalEmbeddingsContext.Provider value={embeddings}>
      <LocalGistsContext.Provider value={gists}>{children}</LocalGistsContext.Provider>
    </LocalEmbeddingsContext.Provider>
  );
}

