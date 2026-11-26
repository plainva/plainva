import type { LocalGistsState } from "./localGists";

export { LocalGistsContext, useLocalGists, LocalModelsProvider } from "../aiPorts/localModels";

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
