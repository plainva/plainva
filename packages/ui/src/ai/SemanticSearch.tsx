import { createContext, useContext, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { EmbeddingProgress, SearchMode, SearchResult } from "@plainva/core";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { Segmented } from "../components/ui/Segmented";
import type { LocalEmbeddings, LocalEmbeddingsState } from "./localEmbeddings";

/**
 * The three pieces search by meaning adds to the ONE search both shells
 * share (plan KI-Harness P2a-4, Design Language "Search by meaning"): the
 * mode switch in the head of the result list, the origin of a hit, and the
 * coverage line under the list. All three appear only while a local model
 * is active on this device.
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

export function SearchModeSwitch({ mode, onChange }: { mode: SearchMode; onChange: (mode: SearchMode) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      size="sm"
      className="pv-semantic-mode"
      ariaLabel={t("search.by")}
      value={mode}
      onChange={onChange}
      options={[
        { value: "words", label: t("search.byWords"), testId: "search-mode-words" },
        { value: "meaning", label: t("search.byMeaning"), testId: "search-mode-meaning" },
        { value: "both", label: t("search.byBoth"), testId: "search-mode-both" },
      ]}
    />
  );
}

/** What found a hit, where words and meaning share a list. */
export function FoundChip({ found }: { found: SearchResult["found"] }) {
  const { t } = useTranslation();
  if (!found) return null;
  const label = found === "words" ? t("search.foundWords") : found === "meaning" ? t("search.foundMeaning") : t("search.foundBoth");
  return (
    <Chip size="sm" tone="muted">
      {label}
    </Chip>
  );
}

/** "Meaning knows n of m notes" while the vectors are not complete; nothing once they are. */
export function SemanticCoverage({
  progress,
  onPause,
  onResume,
  onSettings,
}: {
  progress: EmbeddingProgress;
  onPause: () => void;
  onResume: () => void;
  onSettings?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const missing = progress.total - progress.current;
  if (progress.total === 0 || missing <= 0) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const values = { done: number.format(progress.current), total: number.format(progress.total) };
  const paused = progress.state === "paused";
  const share = Math.round((progress.current / progress.total) * 100);
  return (
    <div className="pv-semantic-coverage" role="status">
      <span>{paused ? t("search.coveragePaused", values) : t("search.coverage", values)}</span>
      <span className="pv-semantic-coverage-actions">
        <Button variant="ghost" size="sm" onClick={paused ? onResume : onPause}>
          {paused ? t("search.coverageResume") : t("search.coveragePause")}
        </Button>
        {onSettings && (
          <Button variant="ghost" size="sm" onClick={onSettings}>
            {t("search.coverageSettings")}
          </Button>
        )}
      </span>
      <div className="pv-security-progress" aria-hidden="true">
        <div className="pv-security-progress-bar" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** The mode switch of the vault's search by meaning; nothing while no model is active. */
export function ActiveSearchModeSwitch({ onChange }: { onChange: (mode: SearchMode) => void }) {
  const { state } = useLocalEmbeddings();
  if (!state || !meaningActive(state)) return null;
  return <SearchModeSwitch mode={state.mode} onChange={onChange} />;
}

/** The coverage line of the vault's search by meaning, with its pause; nothing once every note is embedded. */
export function ActiveSemanticCoverage({ onSettings }: { onSettings?: () => void }) {
  const { controller, state } = useLocalEmbeddings();
  if (!controller || !state || !meaningActive(state)) return null;
  return <SemanticCoverage progress={state.progress} onPause={() => controller.pause()} onResume={() => controller.resume()} onSettings={onSettings} />;
}
