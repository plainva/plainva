import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ROUTINE_NAME_MAX, ROUTINES_MAX, routineDraftOf, type Routine, type RoutineDraft } from "@plainva/core";
import {
  AiRoutineConfirm,
  Banner,
  Button,
  Checkbox,
  Chip,
  newRoutineDraft,
  routineChoiceKey,
  routineDayName,
  routineWeek,
  Segmented,
  Select,
  TextInput,
  toast,
  useRoutineForm,
  type RoutineModelOption,
  type RoutineSkillOption,
} from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * Setting a routine up on the phone (plan KI-Harness P8, mockup chapter 24) —
 * the desktop's dialog in the grammar of a sheet, over the same model
 * (`useRoutineForm`): the form, then what holds for a run nobody watches.
 * Only the yes there makes the routine. `review` opens a routine that rests
 * or needs its user at the second step, with what a run would send now.
 */
export function RoutineSheet({
  routine,
  review,
  skills,
  models,
  weekStart,
  onClose,
  onOpenNote,
}: {
  routine: Routine | null;
  review: boolean;
  skills: readonly RoutineSkillOption[];
  models: readonly RoutineModelOption[];
  weekStart: number;
  onClose: () => void;
  onOpenNote?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const [initial] = useState<RoutineDraft>(() => (routine ? routineDraftOf(routine) : newRoutineDraft(skills[0]?.id ?? "", models[0]?.choice ?? null)));
  const form = useRoutineForm(session, initial, { ...(routine ? { id: routine.id } : {}), review });
  const { draft } = form;
  const skill = skills.find((option) => option.id === draft.skill);
  const confirm = () => {
    void form.confirm().then((saved) => {
      if (saved === "saved") onClose();
      else toast.error(saved === "full" ? t("ai.routines.full", { max: ROUTINES_MAX }) : t("ai.routines.refused.failed"));
    });
  };
  const refusal = form.refused ? (
    <Banner kind="warning">
      <span data-testid="ai-routine-refused">{t(`ai.routines.refused.${form.refused === "off" ? "failed" : form.refused}`)}</span>
    </Banner>
  ) : null;

  if (form.step === "confirm") {
    return (
      <div className="m-sheet-backdrop" onClick={onClose}>
        <div className="pv-sheet m-sheet" onClick={(event) => event.stopPropagation()} data-testid="ai-routine-confirm">
          <SheetGrip onClose={onClose} />
          <p className="m-sheet-title">{t("ai.routines.confirm.title", { name: draft.name.trim() })}</p>
          {refusal}
          {form.preview && <AiRoutineConfirm draft={draft} preview={form.preview} weekStart={weekStart} touch {...(onOpenNote ? { onOpenNote } : {})} />}
          <Button variant="primary" disabled={!form.preview || form.busy} onClick={confirm} data-testid="ai-routine-save">
            {routine ? t("ai.routines.confirm.saveAgain") : t("ai.routines.confirm.save")}
          </Button>
          <Button variant="ghost" onClick={form.back} data-testid="ai-routine-back">
            {routine && review ? t("common.edit") : t("common.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(event) => event.stopPropagation()} data-testid="ai-routine-form">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{routine ? t("ai.routines.form.titleEdit") : t("ai.routines.form.titleNew")}</p>
        <TextInput value={draft.name} maxLength={ROUTINE_NAME_MAX} placeholder={t("ai.routines.form.namePlaceholder")} aria-label={t("ai.routines.form.name")} onChange={(event) => form.change({ name: event.target.value })} data-testid="ai-routine-name" />
        <div className="m-field">
          <span>{t("ai.routines.form.skill")}</span>
          <Select value={draft.skill} options={skills.map((option) => ({ value: option.id, label: option.title }))} onChange={(value) => form.change({ skill: value })} ariaLabel={t("ai.routines.form.skill")} minWidth="100%" data-testid="ai-routine-skill" />
        </div>
        <p className="m-hint">{t("ai.routines.form.skillDesc")}</p>
        <div className="m-field">
          <span>{t("ai.routines.form.request")}</span>
          <TextInput value={draft.request} maxLength={500} placeholder={skill?.request ?? ""} aria-label={t("ai.routines.form.request")} onChange={(event) => form.change({ request: event.target.value })} data-testid="ai-routine-request" />
        </div>
        <p className="m-hint">{t("ai.routines.form.requestDesc")}</p>
        <div className="m-field">
          <span>{t("ai.routines.form.when")}</span>
          <div className="pv-ai-chips" role="group" aria-label={t("ai.routines.form.when")}>
            {routineWeek(weekStart).map((day) => (
              <Chip key={day} selected={draft.days.includes(day)} onClick={() => form.toggleDay(day)} testId={`ai-routine-day-${day}`}>
                {routineDayName(day, i18n.language)}
              </Chip>
            ))}
          </div>
          <TextInput type="time" value={draft.time} aria-label={t("ai.routines.form.time")} onChange={(event) => form.change({ time: event.target.value })} data-testid="ai-routine-time" />
        </div>
        <p className="m-hint">{t("ai.routines.form.whenDesc")}</p>
        <div className="m-field">
          <span>{t("ai.routines.form.missed")}</span>
          <Segmented<"catch-up" | "skip">
            ariaLabel={t("ai.routines.form.missed")}
            value={draft.missed}
            onChange={(missed) => form.change({ missed })}
            options={[
              { value: "catch-up", label: t("ai.routines.form.catchUp"), testId: "ai-routine-catchup" },
              { value: "skip", label: t("ai.routines.form.skip"), testId: "ai-routine-skip" },
            ]}
          />
        </div>
        <p className="m-hint">{t("ai.routines.form.missedDesc")}</p>
        <Checkbox checked={draft.onlyWhenChanged} onChange={(event) => form.change({ onlyWhenChanged: event.target.checked })} data-testid="ai-routine-changed">
          {t("ai.routines.form.changed")}
        </Checkbox>
        <p className="m-hint">{t("ai.routines.form.changedDesc")}</p>
        <div className="m-field">
          <span>{t("ai.routines.form.model")}</span>
          {models.length > 0 ? (
            <Select
              value={draft.choice ? routineChoiceKey(draft.choice) : ""}
              options={models.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => form.change({ choice: models.find((option) => option.value === value)?.choice ?? null })}
              ariaLabel={t("ai.routines.form.model")}
              minWidth="100%"
              data-testid="ai-routine-model"
            />
          ) : (
            <span className="m-hint">{t("ai.routines.form.noModel")}</span>
          )}
        </div>
        <p className="m-hint">{t("ai.routines.form.modelDesc")}</p>
        {refusal}
        <Button variant="primary" disabled={form.problems.length > 0 || form.busy} onClick={form.toConfirm} data-testid="ai-routine-next">
          {t("common.next")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
