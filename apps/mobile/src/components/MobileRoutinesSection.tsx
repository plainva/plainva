import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Plus } from "lucide-react";
import { ROUTINES_MAX, type Routine } from "@plainva/core";
import { AreaBoundary, GroupCard, ICON, Row, RowList, routineModelOptions, routineNow, routineRows, routineSkillOptions, SectionLabel, toast, useDirectFolders, useMinuteClock, useTodayKey, useWeekStartDay } from "@plainva/ui";
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
  // Folders that let changes go without asking (plan "KI direkt schreiben", W4): a skill that changes notes can run then.
  const direct = useDirectFolders(session, state.routines.list);
  if (!state.settings.enabled || !state.routines.available) return null;

  const { list, running } = state.routines;
  const entries = state.skills.entries;
  const rows = routineRows(t, { list, running, entries, settings: state.settings, keys: state.keys, direct }, now, i18n.language, weekStart);
  const skills = routineSkillOptions(t, entries, direct);
  const noteName = (note: string) => note.slice(note.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  /** What a routine's last run changed directly (plan W4), in one line: "Changed: 2 notes, 1 new". */
  const changedLine = (routine: Routine) => {
    const applied = routine.last?.applied ?? [];
    if (!applied.length) return null;
    const made = applied.filter((entry) => entry.created).length;
    const list = [applied.length - made ? t("ai.direct.notes", { count: applied.length - made }) : "", made ? t("ai.direct.made", { count: made }) : ""].filter(Boolean).join(", ");
    return t("ai.direct.changed", { list });
  };
  /** Takes back what a routine's last run changed directly, and says what became of each note. */
  const undo = async (routine: Routine, path?: string) => {
    const report = await session.undoRoutineDirect(routine.id, path);
    if (report.undone.length) toast.success(t("ai.direct.undoneToast", { count: report.undone.length }));
    for (const note of report.changed) toast.info(t("ai.direct.changedSince", { name: noteName(note) }), { label: t("ai.direct.compare"), run: () => session.showVersions(note) });
    for (const note of report.failed) toast.error(t("ai.direct.undoFailed", { name: noteName(note) }));
  };
  const full = list.length >= ROUTINES_MAX;

  const act = async (routine: Routine, need: boolean) => {
    const busy = running !== null;
    // What its last run changed directly (plan W4): each note to look at or take back, and all of them — the desktop's
    // list in the grammar of an action sheet.
    const open = running?.id === routine.id ? [] : (routine.last?.applied ?? []).filter((entry) => !entry.undone);
    const pick = await mActions({
      title: routine.name,
      options: [
        ...(need ? [{ value: "review", label: t("ai.routines.review") }] : []),
        ...open.flatMap((entry) => [
          { value: `view:${entry.path}`, label: `${t("ai.direct.view")} · ${noteName(entry.path)}` },
          { value: `undo:${entry.path}`, label: `${t("ai.direct.undo")} · ${noteName(entry.path)}` },
        ]),
        ...(open.length > 1 ? [{ value: "undo-all", label: t("ai.direct.undoAll") }] : []),
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
    if (pick?.startsWith("view:")) onOpenNote?.(pick.slice(5));
    else if (pick?.startsWith("undo:")) void undo(routine, pick.slice(5));
    else if (pick === "undo-all") void undo(routine);
    else if (pick === "review") setSheet({ routine, review: true });
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
      <SectionLabel info={t("ai.routines.note")}>{t("ai.routines.title")}</SectionLabel>
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
                    {changedLine(routine) && <span data-testid="settings-ai-routine-changed">{changedLine(routine)}</span>}
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
            subtitle={full ? t("ai.routines.full", { max: ROUTINES_MAX }) : skills.length === 0 ? t("ai.routines.noSkill") : direct ? t("ai.routines.eligibleDirect") : t("ai.routines.eligible")}
            disabled={full}
            onClick={() => setSheet({ routine: null, review: false })}
            data-testid="settings-ai-routine-add"
          />
        </RowList>
      </GroupCard>
      {sheet && (
        <AreaBoundary area="sheet:routine" size="dialog" resetKey={sheet.routine?.id ?? "new"} exit={{ label: t("common.close"), onExit: () => setSheet(null) }}>
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
        </AreaBoundary>
      )}
    </>
  );
}
