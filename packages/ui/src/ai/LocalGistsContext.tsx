import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { LocalEmbeddings } from "./localEmbeddings";
import type { LocalGists, LocalGistsState } from "./localGists";
import { LocalEmbeddingsContext } from "./SemanticSearch";

/** The vault's gists (plan KI-Harness P2b-3), for the settings of both shells. */
export const LocalGistsContext = createContext<LocalGists | null>(null);

const NOOP_SUBSCRIBE = () => () => undefined;
const NO_STATE = (): LocalGistsState | null => null;

export function useLocalGists(): { controller: LocalGists | null; state: LocalGistsState | null } {
  const controller = useContext(LocalGistsContext);
  const state = useSyncExternalStore(controller ? controller.subscribe : NOOP_SUBSCRIBE, controller ? controller.snapshot : NO_STATE, controller ? controller.snapshot : NO_STATE);
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

type T = (key: string, options?: Record<string, unknown>) => string;

/** The settings' line under the switch: what is written, by which model, or why nothing is. */
export function gistsStatusLine(t: T, state: LocalGistsState | null, language: string): string | null {
  if (!state || state.kind === "off") return null;
  if (state.kind === "no-model") return t("ai.gists.noModel");
  if (state.failure) return t("ai.gists.failed", { reason: state.failure });
  const number = new Intl.NumberFormat(language);
  const line = t("ai.gists.status", { covered: number.format(state.covered), sections: number.format(state.sections), model: state.model });
  return state.working ? `${line} · ${t("ai.gists.working")}` : state.paused ? `${line} · ${t("ai.gists.paused")}` : line;
}
