import { Sparkles } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AiSession, AiState, FillOutcome, FillProgress, FilterWordsOutcome } from "../ai/aiSession";
import type { FillColumn } from "../ai/aiFill";
import type { FilterSchemaColumn } from "../ai/aiBaseFilter";
import { loadAiModule, useAiModule } from "../aiPorts/aiModule";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { useStableHandler } from "../lib/useStableHandler";

/**
 * The assistant at a database (plan KI-Harness P5-4), the same in both
 * shells: whether it is offered there, a run that fills a column — its plan,
 * its progress above the entries, the words for how it ended —, and the
 * filter a sentence becomes. What a run does and what goes to the model lives
 * in the session (`fillProperty`, `filterFromWords`); nothing here decides
 * either. What needs the harness — the words of an outcome, the filter in
 * words — is `ai/baseAiParts.tsx`, which loads with the AI (review of L5).
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
  // The harness is loaded once there is a session (`aiPorts/sessionLoader.ts`): the provider's name comes from it.
  const ai = useAiModule();
  const provider = choice && state ? (ai?.aiProviderLabel(choice.providerId, state.settings.custom) ?? choice.providerId) : null;
  const modelName = choice?.model ?? null;
  const canFill = !options.sealed;
  const busy = running !== null;
  const startFill = useStableHandler(async (column: FillColumn, rows: readonly { path: string; title: string }[]): Promise<FillOutcome> => {
    if (!session || base === null) return { kind: "refused", reason: "off" };
    const outcome = await session.fillProperty({ base, column, rows });
    (ai ?? (await loadAiModule())).reportFill(t, outcome, column.label);
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

