import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Plus } from "lucide-react";
import { ROUTINES_MAX, type Routine } from "@plainva/core";
import { GroupCard, ICON, Row, RowList, routineModelOptions, routineNow, routineRows, routineSkillOptions, SectionLabel, toast, useMinuteClock, useTodayKey, useWeekStartDay } from "@plainva/ui";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { mActions, mConfirm } from "../services/mobileDialogs";
import { RoutineSheet } from "./RoutineSheet";

/**
 * The routines of this vault on this phone (plan KI-Harness P8, mockup
 * chapter 24): the desktop's card in the grammar of a list. A row says what
 * a routine does and when, how its last run ended and when the next stands —
 * or what it needs. Tapping it offers what can be done with it; setting one
 * up is the sheet (`RoutineSheet`). The rows and their texts are the shared
 * view model (`routineRows`). `folders` are the vault's folders, for a
 * routine that keeps a folder's log (plan P8-2).
 */
export function MobileRoutinesSection({ onOpenNote, folders = [] }: { onOpenNote?: (path: string) => void; folders?: readonly string[] }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const weekStart = useWeekStartDay();
  const day = useTodayKey();
  const clock = useMinuteClock();
  const [sheet, setSheet] = useState<{ routine: Routine | null; review: boolean } | null>(null);
  useEffect(() => {
    void session.refreshSkills();
  }, [session]);
  const now = useMemo(() => routineNow(day, clock), [day, clock]);
  if (!state.settings.enabled || !state.routines.available) return null;

  const { list, running } = state.routines;
  const entries = state.skills.entries;
  const rows = routineRows(t, { list, running, entries, settings: state.settings, keys: state.keys }, now, i18n.language, weekStart);
  const skills = routineSkillOptions(t, entries);
  const full = list.length >= ROUTINES_MAX;

  const act = async (routine: Routine, need: boolean) => {
    const busy = running !== null;
    const pick = await mActions({
      title: routine.name,
      options: [
        ...(need ? [{ value: "review", label: t("ai.routines.review") }] : []),
        ...(busy ? [] : [{ value: "run", label: t("ai.routines.runNow") }]),
        ...(running?.id === routine.id
          ? []
          : [
              { value: "pause", label: routine.paused ? t("ai.semantic.resume") : t("ai.semantic.pause") },
              { value: "edit", label: t("common.edit") },
              { value: "remove", label: t("ai.routines.remove"), danger: true },
            ]),
      ],
    });
    if (pick === "review") setSheet({ routine, review: true });
    else if (pick === "edit") setSheet({ routine, review: false });
    else if (pick === "pause") void session.pauseRoutine(routine.id, !routine.paused);
    else if (pick === "run") {
      void session.runRoutine(routine.id, "hand").then((outcome) => {
        if (outcome.kind === "refused" && outcome.reason === "busy") toast.info(t("ai.routines.busy"));
      });
    } else if (pick === "remove") {
      if (await mConfirm({ title: t("ai.routines.removeTitle", { name: routine.name }), message: t("ai.routines.removeBody"), danger: true, confirmLabel: t("ai.routines.remove") })) void session.removeRoutine(routine.id);
    }
  };

  return (
    <>
      <SectionLabel>{t("ai.routines.title")}</SectionLabel>
      <p className="m-hint">{t("ai.routines.note")}</p>
      <GroupCard>
        <RowList>
          {rows.map((row) => {
            const routine = list.find((candidate) => candidate.id === row.id)!;
            return (
              <Row
                key={row.id}
                wrap
                icon={<CalendarClock size={ICON.ui} />}
                title={row.name}
                subtitle={
                  <>
                    <span>{row.line}</span>
                    <span data-testid="settings-ai-routine-status">{row.status}</span>
                  </>
                }
                onClick={() => void act(routine, row.need !== null)}
                data-testid="settings-ai-routine"
              />
            );
          })}
          {/* A folder's log needs no skill: without one, a new routine starts as a log. */}
          <Row
            wrap
            icon={<Plus size={ICON.ui} />}
            title={t("ai.routines.add")}
            subtitle={full ? t("ai.routines.full", { max: ROUTINES_MAX }) : skills.length === 0 ? t("ai.routines.noSkill") : t("ai.routines.eligible")}
            disabled={full}
            onClick={() => setSheet({ routine: null, review: false })}
            data-testid="settings-ai-routine-add"
          />
        </RowList>
      </GroupCard>
      {sheet && (
        <RoutineSheet
          key={sheet.routine?.id ?? "new"}
          routine={sheet.routine}
          review={sheet.review}
          skills={skills}
          folders={folders}
          models={routineModelOptions(t, state.settings, sheet.routine?.choice ?? null)}
          weekStart={weekStart}
          onClose={() => setSheet(null)}
          {...(onOpenNote ? { onOpenNote } : {})}
        />
      )}
    </>
  );
}
