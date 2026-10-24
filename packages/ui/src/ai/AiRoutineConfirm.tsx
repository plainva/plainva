import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { routineDays, type RoutineDraft } from "@plainva/core";
import { Banner } from "../components/ui/Banner";
import { AiSendOverview } from "./AiSendOverview";
import type { RoutinePreview } from "./aiSession";
import { routineScheduleText } from "./routineView";

/**
 * What holds for a run nobody watches (plan KI-Harness P8, mockup chapter 24,
 * step 3): the body of a routine's confirmation, the same on the desktop's
 * dialog and the phone's sheet. It says what a routine may do, who reads,
 * what it leaves and when it stops — and, for a provider's model, shows what
 * a run would send today, put together like a run and not sent. On a second
 * look the overview names what would go beyond what was confirmed.
 */
export interface AiRoutineConfirmProps {
  draft: RoutineDraft;
  preview: RoutinePreview;
  weekStart?: number;
  touch?: boolean;
  onOpenNote?: (path: string) => void;
}

export function AiRoutineConfirm({ draft, preview, weekStart = 1, touch, onOpenNote }: AiRoutineConfirmProps) {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const schedule = routineScheduleText(t, { days: routineDays(draft.days), time: draft.time }, i18n.language, weekStart);
  const who = { provider: preview.provider, model: preview.model };
  const note = { folder: preview.folder, title: preview.noteTitle };
  return (
    <>
      <dl className="pv-skill-facts" data-testid="ai-routine-facts">
        <dt>{t("ai.routines.confirm.reads")}</dt>
        <dd>
          {t("ai.routines.confirm.readsDesc")}
          {preview.noMail && (
            <span className="pv-ai-overview-hint" data-testid="ai-routine-nomail">
              {t("ai.routines.confirm.noMail")}
            </span>
          )}
        </dd>
        <dt>{t("ai.routines.confirm.budget")}</dt>
        <dd data-testid="ai-routine-budget">
          {t("ai.routines.confirm.budgetDesc", { steps: number.format(preview.limits.maxSteps), calls: number.format(preview.limits.maxToolCalls), tokens: number.format(preview.limits.maxOutputTokens) })}
        </dd>
        <dt>{t("ai.routines.confirm.who")}</dt>
        <dd data-testid="ai-routine-who">{preview.here ? t("ai.routines.confirm.whoHere", who) : t("ai.routines.confirm.whoAway", who)}</dd>
        <dt>{t("ai.routines.confirm.result")}</dt>
        <dd data-testid="ai-routine-result">{preview.folder ? t("ai.routines.confirm.resultDesc", note) : t("ai.routines.confirm.resultTop", note)}</dd>
        <dt>{t("ai.routines.confirm.needs")}</dt>
        <dd>{t("ai.routines.confirm.needsDesc")}</dd>
        <dt>{t("ai.routines.confirm.when")}</dt>
        <dd data-testid="ai-routine-when">{draft.missed === "skip" ? t("ai.routines.confirm.whenSkip", { schedule }) : t("ai.routines.confirm.whenCatchUp", { schedule })}</dd>
      </dl>
      {preview.everyRequest && (
        <Banner kind="warning" rounded>
          <span data-testid="ai-routine-every">{t("ai.routines.confirm.everyRequest")}</span>
        </Banner>
      )}
      {preview.shared && (
        <Banner kind="info" rounded>
          <span data-testid="ai-routine-shared">{t("ai.routines.confirm.shared")}</span>
        </Banner>
      )}
      {!preview.here && (
        <AiSendOverview manifest={preview.manifest} growth={preview.growth} preview={{ title: t("ai.routines.confirm.overview", { provider: preview.provider }) }} touch={touch} {...(onOpenNote ? { onOpenNote } : {})} />
      )}
    </>
  );
}
