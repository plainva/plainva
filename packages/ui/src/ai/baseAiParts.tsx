import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { providerById, type CustomEndpoint } from "@plainva/core/ai";
import type { FillOutcome } from "./aiSession";
import { countFilterMatches, FILTER_WORDS_LIMITS, type FilterSchemaColumn } from "./aiBaseFilter";
import { aiFailureText } from "./aiSettingsModel";
import type { BaseAi } from "../base/BaseAi";
import { baseFilterOpLabels } from "../base/baseFilterCatalog";
import type { PropertyFilterRule } from "../base/filterExpr";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { TextInput } from "../components/ui/Field";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";

/*
 * The parts of a database's assistant that need the harness (performance plan L5; review of L5, 2026-11-25): they
 * load with the AI, never with a database — `base/BaseAi.tsx` keeps what a database shows without it. A shell draws
 * `FilterInWords` through `aiComponent`, which draws nothing while the harness is not loaded.
 */

/** The provider's name as a plan says it. */
export function aiProviderLabel(providerId: string, custom: readonly CustomEndpoint[]): string {
  return providerById(providerId, custom)?.label ?? providerId;
}

/**
 * One toast for a run that fills a column: what was proposed, and what was
 * not and why — in numbers. A send overview the user declined says nothing:
 * that was their answer.
 */
export function reportFill(t: TFunction, outcome: FillOutcome, column: string): void {
  if (outcome.kind === "refused") {
    if (outcome.reason === "cancelled") return;
    if (outcome.reason === "busy") toast.info(t("database.fill.refused.busy"));
    else toast.error(t(`database.fill.refused.${outcome.reason}`, { column }));
    return;
  }
  const words = [
    t("database.fill.proposed", { count: outcome.proposed, column }),
    outcome.silent ? t("database.fill.silent", { count: outcome.silent }) : "",
    outcome.kept ? t("database.fill.kept", { count: outcome.kept }) : "",
    outcome.failed ? t("database.fill.failed", { count: outcome.failed }) : "",
    outcome.stopped ? t("database.fill.stopped") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // Rows before it went out (review B7-4, M-R4-6): the run's sentence about sending stays empty then.
  if (outcome.failure) toast.error(`${aiFailureText(t, outcome.failure, outcome.provider, outcome.model, outcome.departed ? { sent: "" } : {})} ${words}`);
  else if (outcome.proposed > 0) toast.success(words);
  else toast.info(words);
}

/** A rule in the words the filter list uses: the column's name, the operator, the value. */
export function filterRuleWords(t: TFunction, rule: PropertyFilterRule, columns: readonly FilterSchemaColumn[]): string {
  const column = columns.find((candidate) => candidate.key === rule.column);
  const temporal = column?.input === "date" || column?.input === "datetime";
  const op = baseFilterOpLabels(t, temporal)[rule.op] ?? rule.op;
  const value = rule.op === "empty" || rule.op === "notEmpty" ? "" : column?.input === "checkbox" ? (rule.value === "true" ? "☑" : "☐") : rule.value;
  return [column?.label ?? rule.column, op, value].filter(Boolean).join(" ");
}

/**
 * A filter in words: the sentence, and what a model made of it — shown as the
 * rules it would be, with how many entries they would leave, before anything
 * is filtered. `onApply` adds the rules to the view; nothing else does.
 */
export function FilterInWords({
  ai,
  columns,
  rows,
  onApply,
}: {
  ai: BaseAi;
  /** The columns a sentence may filter by — what goes to the model, and nothing else of the database. */
  columns: readonly FilterSchemaColumn[];
  /** The database's entries, for the count in the preview. Counted on this device; none of them is sent. */
  rows: readonly Record<string, unknown>[];
  onApply(rules: PropertyFilterRule[], logic: "all" | "any"): void;
}) {
  const { t } = useTranslation();
  const [words, setWords] = useState("");
  const [asking, setAsking] = useState(false);
  const [found, setFound] = useState<{ rules: PropertyFilterRule[]; logic: "all" | "any" } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sentence = words.trim();
  const ask = async () => {
    if (!sentence || asking) return;
    setAsking(true);
    setProblem(null);
    setFound(null);
    try {
      const outcome = await ai.filterFromWords(sentence, columns);
      if (outcome.kind === "rules") setFound({ rules: outcome.rules, logic: outcome.logic });
      // A send overview the user declined is their answer, and needs no sentence.
      else if (outcome.reason !== "cancelled") {
        setProblem(outcome.reason === "failed" && outcome.failure ? aiFailureText(t, outcome.failure, outcome.provider ?? "", outcome.model) : t(`database.filterWords.refused.${outcome.reason}`));
      }
    } finally {
      setAsking(false);
    }
  };
  const matches = found ? countFilterMatches(rows, found.rules, found.logic) : null;
  return (
    <div className="pv-filterwords" data-testid="base-filter-words">
      <div className="pv-filterwords-ask">
        <TextInput
          compact
          purpose="prose"
          value={words}
          maxLength={FILTER_WORDS_LIMITS.words}
          placeholder={t("database.filterWords.placeholder")}
          aria-label={t("database.filterWords.label")}
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask();
            }
          }}
          data-testid="base-filter-words-input"
        />
        <Button size="sm" icon={<Sparkles size={ICON.meta} />} disabled={!sentence || asking || columns.length === 0} onClick={() => void ask()} data-testid="base-filter-words-ask">
          {asking ? t("database.filterWords.asking") : t("database.filterWords.ask")}
        </Button>
      </div>
      {/* Said where it is asked, every time: a send overview only comes when the scope grows. */}
      <span className="pv-filterwords-note" data-testid="base-filter-words-sends">
        {t("database.filterWords.sends")}
      </span>
      {problem && (
        <Banner kind="warning" rounded testId="base-filter-words-problem">
          {problem}
        </Banner>
      )}
      {found && (
        <div className="pv-filterwords-result" data-testid="base-filter-words-result">
          <span className="pv-filterwords-note">
            {found.rules.length === 1 ? t("database.filterWords.one") : found.logic === "any" ? t("database.filterWords.any") : t("database.filterWords.all")}
          </span>
          <div className="pv-filterwords-rules">
            {found.rules.map((rule, index) => (
              <Chip key={index} size="sm" testId="base-filter-words-rule">
                {filterRuleWords(t, rule, columns)}
              </Chip>
            ))}
          </div>
          {matches !== null && (
            <span className="pv-filterwords-note" data-testid="base-filter-words-count">
              {t("database.filterWords.matches", { n: matches, total: rows.length })}
            </span>
          )}
          <div className="pv-filterwords-actions">
            <Button size="sm" variant="ghost" onClick={() => setFound(null)} data-testid="base-filter-words-discard">
              {t("database.filterWords.discard")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onApply(found.rules, found.logic);
                setFound(null);
                setWords("");
              }}
              data-testid="base-filter-words-apply"
            >
              {t("database.filterWords.apply")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
