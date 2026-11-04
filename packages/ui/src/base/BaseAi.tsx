import { Sparkles } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { providerById } from "@plainva/core";
import type { AiSession, AiState, FillOutcome, FillProgress, FilterWordsOutcome } from "../ai/aiSession";
import type { FillColumn } from "../ai/aiFill";
import { countFilterMatches, FILTER_WORDS_LIMITS, type FilterSchemaColumn } from "../ai/aiBaseFilter";
import { aiFailureText } from "../ai/aiSettingsModel";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { TextInput } from "../components/ui/Field";
import { ICON } from "../lib/iconSizes";
import { useStableHandler } from "../lib/useStableHandler";
import { toast } from "../services/toastStore";
import { baseFilterOpLabels } from "./baseFilterCatalog";
import type { PropertyFilterRule } from "./filterExpr";

/**
 * The assistant at a database (plan KI-Harness P5-4), the same in both
 * shells: whether it is offered there, a run that fills a column — its plan,
 * its progress above the entries, the words for how it ended —, and the
 * filter a sentence becomes. What a run does and what goes to the model lives
 * in the session (`fillProperty`, `filterFromWords`); nothing here decides
 * either.
 */

const NO_STATE = (): AiState | null => null;
const NO_SUBSCRIPTION = () => () => {};

export interface BaseAi {
  /**
   * Whether a column can be filled here. Not inside an encrypted workspace:
   * a proposed value is a suggestion, and its sealed comments cannot name the
   * assistant as their author yet (E32). A filter in words proposes nothing
   * to a note, so it is offered there too.
   */
  canFill: boolean;
  /** The run that fills a column of THIS database right now. */
  fill: FillProgress | null;
  /** A run fills a column somewhere — one at a time, whatever database. */
  busy: boolean;
  /** The model a run would ask, as the plan names it; null while none is chosen. */
  model: { provider: string; model: string } | null;
  /** Runs, and says how it ended. */
  startFill(column: FillColumn, rows: readonly { path: string; title: string }[]): Promise<FillOutcome>;
  stopFill(): void;
  filterFromWords(words: string, columns: readonly FilterSchemaColumn[]): Promise<FilterWordsOutcome>;
}

/**
 * The assistant for one database; null while the AI is off on this device or
 * reads no vault — the surfaces then show none of its doors.
 */
export function useBaseAi(session: AiSession | null, base: string | null, options: { sealed: boolean }): BaseAi | null {
  const { t } = useTranslation();
  const state = useSyncExternalStore(session ? session.subscribe : NO_SUBSCRIPTION, session ? session.getState : NO_STATE, session ? session.getState : NO_STATE);
  const offered = Boolean(session && state?.loaded && state.settings.enabled && state.hasVault) && base !== null;
  const running = state?.fill ?? null;
  const fill = running && running.base === base ? running : null;
  const choice = offered && session ? session.newConversationChoice() : null;
  const provider = choice && state ? (providerById(choice.providerId, state.settings.custom)?.label ?? choice.providerId) : null;
  const modelName = choice?.model ?? null;
  const canFill = !options.sealed;
  const busy = running !== null;
  const startFill = useStableHandler(async (column: FillColumn, rows: readonly { path: string; title: string }[]): Promise<FillOutcome> => {
    if (!session || base === null) return { kind: "refused", reason: "off" };
    const outcome = await session.fillProperty({ base, column, rows });
    reportFill(t, outcome, column.label);
    return outcome;
  });
  const stopFill = useStableHandler(() => session?.stopFill());
  const filterFromWords = useStableHandler(async (words: string, columns: readonly FilterSchemaColumn[]): Promise<FilterWordsOutcome> => {
    if (!session || base === null) return { kind: "refused", reason: "off" };
    return session.filterFromWords({ base, words, columns });
  });
  return useMemo<BaseAi | null>(
    () => (offered ? { canFill, fill, busy, model: provider !== null && modelName !== null ? { provider, model: modelName } : null, startFill, stopFill, filterFromWords } : null),
    [offered, canFill, fill, busy, provider, modelName, startFill, stopFill, filterFromWords],
  );
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
  if (outcome.failure) toast.error(`${aiFailureText(t, outcome.failure, outcome.provider, outcome.model)} ${words}`);
  else if (outcome.proposed > 0) toast.success(words);
  else toast.info(words);
}

/** What a run would take: the entries without a value, the first of them, and those a value already waits for. */
export interface FillPlan {
  rows: readonly { path: string; title: string }[];
  missing: number;
  waiting: number;
}

/**
 * The plan of a run in sentences, before it starts — what the desktop's
 * dialog and the phone's question both say: how many entries, that each note
 * is read on its own, that nothing is written.
 */
export function fillPlanLines(t: TFunction, plan: FillPlan, model: BaseAi["model"]): string[] {
  if (plan.missing === 0) return [plan.waiting > 0 ? t("database.fill.allWaiting", { count: plan.waiting }) : t("database.fill.nothing")];
  return [
    `${t("database.fill.count", { count: plan.missing })}${plan.missing > plan.rows.length ? ` ${t("database.fill.firstOnly", { max: plan.rows.length })}` : ""}`,
    ...(plan.waiting > 0 ? [t("database.fill.waiting", { count: plan.waiting })] : []),
    t("database.fill.how"),
    model ? t("database.fill.model", { provider: model.provider, model: model.model }) : t("database.fill.noModel"),
  ];
}

/** The plan as the desktop's dialog shows it: the sentences, and the column's choices where it has some. */
export function FillPlanBody({ column, plan, model }: { column: FillColumn; plan: FillPlan; model: BaseAi["model"] }) {
  const { t } = useTranslation();
  const lines = fillPlanLines(t, plan, model);
  return (
    <div className="pv-fillplan" data-testid="base-fill-plan">
      {lines.map((line, index) => (
        <p key={index} className={index === 0 ? undefined : "pv-fillplan-how"}>
          {line}
        </p>
      ))}
      {plan.missing > 0 && column.options && column.options.length > 0 && (
        <div className="pv-fillplan-choices">
          <span className="pv-fillplan-how">{t("database.fill.choices")}</span>
          {column.options.map((option) => (
            <Chip key={option} size="sm" tone="muted">
              {option}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** A run that fills a column, above the entries: how far it is, and the way to end it. */
export function FillProgressBanner({ fill, onStop }: { fill: FillProgress; onStop(): void }) {
  const { t } = useTranslation();
  const percent = fill.total > 0 ? Math.round((fill.done / fill.total) * 100) : 0;
  const words = t("database.fill.running", { column: fill.label, done: fill.done, total: fill.total });
  return (
    <Banner
      kind="info"
      icon={Sparkles}
      testId="base-fill-progress"
      actions={
        <Button size="sm" variant="ghost" onClick={onStop} data-testid="base-fill-stop">
          {t("database.fill.stop")}
        </Button>
      }
    >
      <span className="pv-banner-run">
        <span>{words}</span>
        <span className="pv-security-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={words}>
          <span className="pv-security-progress-bar" style={{ width: `${percent}%` }} />
        </span>
      </span>
    </Banner>
  );
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
