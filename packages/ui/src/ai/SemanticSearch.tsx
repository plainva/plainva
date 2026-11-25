import { useTranslation } from "react-i18next";
import type { SearchResult } from "@plainva/core";
import type { EmbeddingProgress, SearchMode } from "@plainva/core/ai";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { Segmented } from "../components/ui/Segmented";
import { aiFailureText } from "./aiSettingsModel";
import { useLocalEmbeddings, meaningActive } from "../aiPorts/localModels";

/**
 * The three pieces search by meaning adds to the ONE search both shells
 * share (plan KI-Harness P2a-4, Design Language "Search by meaning"): the
 * mode switch in the head of the result list, the origin of a hit, and the
 * coverage line under the list. All three appear only while a model — a
 * package or an own provider's — is active on this device.
 */

export { LocalEmbeddingsContext, useLocalEmbeddings, meaningActive } from "../aiPorts/localModels";

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
  // Notes the rules keep from a cloud model are neither missing nor done: they are not counted.
  const owed = progress.total - progress.withheld;
  const missing = owed - progress.current;
  if (owed <= 0 || missing <= 0) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const values = { done: number.format(progress.current), total: number.format(owed) };
  const paused = progress.state === "paused";
  const share = Math.round((progress.current / owed) * 100);
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

/**
 * The coverage line of the vault's search by meaning, with its pause; nothing
 * once every note is embedded. Above it, when meaning could not answer the
 * last search (an own provider out of reach, a key refused), why the hits are
 * by words.
 */
export function ActiveSemanticCoverage({ onSettings }: { onSettings?: () => void }) {
  const { t } = useTranslation();
  const { controller, state } = useLocalEmbeddings();
  if (!controller || !state || state.engine.kind !== "ready") return null;
  const source = state.engine.source;
  const target = source.kind === "provider" ? source.target : null;
  const failure = state.meaningFailure;
  return (
    <>
      {failure && (
        <div className="pv-semantic-coverage" role="status" data-testid="semantic-unavailable">
          <span>{t("search.meaningUnavailable", { reason: aiFailureText(t, failure, target?.provider.label ?? "", target?.model) })}</span>
        </div>
      )}
      <SemanticCoverage progress={state.progress} onPause={() => controller.pause()} onResume={() => controller.resume()} onSettings={onSettings} />
    </>
  );
}
