import { useEffect, useState } from "react";
import { routineDays, routineDraftProblems, type ModelChoice, type RoutineDay, type RoutineDraft, type RoutineDraftProblem } from "@plainva/core";
import type { AiSession, RoutinePreview, RoutinePreviewRefusal, RoutineSaved } from "./aiSession";

/**
 * Setting a routine up, in two steps (plan KI-Harness P8, mockup chapter 24):
 * the form, then what holds for a run nobody watches — and only after that
 * yes there is a routine. One model for the desktop's dialog and the phone's
 * sheet. A second look at a routine that rests or needs its user starts at
 * the second step, with what a run would send now.
 */

/** What a routine does, as the form's first choice shows it. */
export type RoutineKind = "skill" | "log";

/** The days and the time a new routine of each kind starts with: a skill on the working days at seven; a folder's log every day at six in the evening — the day's changes in one entry. */
const KIND_DEFAULTS: Record<RoutineKind, { days: readonly RoutineDay[]; time: string }> = {
  skill: { days: [1, 2, 3, 4, 5], time: "07:00" },
  log: { days: [0, 1, 2, 3, 4, 5, 6], time: "18:00" },
};

/** What a new routine starts with: the working days, at seven. */
export function newRoutineDraft(skill: string, choice: ModelChoice | null): RoutineDraft {
  return { name: "", skill, request: "", days: [...KIND_DEFAULTS.skill.days], time: KIND_DEFAULTS.skill.time, missed: "catch-up", onlyWhenChanged: false, choice };
}

/** What a new folder's log starts with (plan P8-2): every day at six in the evening. */
export function newLogDraft(choice: ModelChoice | null, folder = ""): RoutineDraft {
  return { name: "", skill: "", request: "", days: [...KIND_DEFAULTS.log.days], time: KIND_DEFAULTS.log.time, missed: "catch-up", onlyWhenChanged: true, choice, log: { folder } };
}

/**
 * The change that makes a form a skill's routine or a folder's log — what the
 * choice "What it does" sets, the same on both shells. A log asks no model
 * while nothing changed, so it looks before every run; a skill's routine
 * gets back the skill it had, or the first one there is. Days and time that
 * are still the other kind's defaults become this kind's; once the user set
 * them, they stay.
 */
export function routineKindPatch(draft: RoutineDraft, kind: RoutineKind, firstSkill: string): Partial<RoutineDraft> {
  const current: RoutineKind = draft.log ? "log" : "skill";
  if (kind === current) return {};
  const other = KIND_DEFAULTS[current];
  const untouched = draft.time === other.time && draft.days.length === other.days.length && other.days.every((day) => draft.days.includes(day));
  const schedule = untouched ? { days: [...KIND_DEFAULTS[kind].days], time: KIND_DEFAULTS[kind].time } : {};
  return kind === "log" ? { log: { folder: "" }, onlyWhenChanged: true, ...schedule } : { log: null, skill: draft.skill || firstSkill, ...schedule };
}

export interface RoutineFormModel {
  draft: RoutineDraft;
  change(patch: Partial<RoutineDraft>): void;
  toggleDay(day: RoutineDay): void;
  /** What keeps the form from going on; empty when it can. */
  problems: RoutineDraftProblem[];
  step: "form" | "confirm";
  /** What a run would send, as the confirmation shows it; null until it was put together. */
  preview: RoutinePreview | null;
  /** Why the confirmation could not be shown. */
  refused: RoutinePreviewRefusal | null;
  /** The confirmation is being put together, or the routine is being stored. */
  busy: boolean;
  /** Puts together what a run would send and shows the confirmation. */
  toConfirm(): void;
  back(): void;
  /** The yes: resolves with whether the routine is stored now. */
  confirm(): Promise<RoutineSaved>;
}

export function useRoutineForm(session: AiSession, initial: RoutineDraft, options: { id?: string; review?: boolean } = {}): RoutineFormModel {
  const { id, review } = options;
  const [draft, setDraft] = useState<RoutineDraft>(initial);
  const [step, setStep] = useState<"form" | "confirm">(review ? "confirm" : "form");
  const [preview, setPreview] = useState<RoutinePreview | null>(null);
  const [refused, setRefused] = useState<RoutinePreviewRefusal | null>(null);
  // The draft whose confirmation is being put together; a second look asks for it at once.
  const [pending, setPending] = useState<RoutineDraft | null>(review ? initial : null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    void session
      .routinePreview(pending, id)
      .catch((): { kind: "refused"; reason: RoutinePreviewRefusal } => ({ kind: "refused", reason: "failed" }))
      .then((outcome) => {
        if (!alive) return;
        if (outcome.kind === "preview") {
          setPreview(outcome.preview);
          setRefused(null);
          setStep("confirm");
        } else {
          setPreview(null);
          setRefused(outcome.reason);
        }
        setPending(null);
      });
    return () => {
      alive = false;
    };
  }, [session, id, pending]);

  const problems = routineDraftProblems(draft);
  // What was shown belongs to the draft it was made for: a change takes it away.
  const change = (patch: Partial<RoutineDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setRefused(null);
  };

  return {
    draft,
    change,
    toggleDay: (day) => change({ days: draft.days.includes(day) ? draft.days.filter((other) => other !== day) : routineDays([...draft.days, day]) }),
    problems,
    step,
    preview,
    refused,
    busy: pending !== null || saving,
    toConfirm: () => {
      if (problems.length || pending || saving) return;
      setRefused(null);
      setPending(draft);
    },
    back: () => setStep("form"),
    confirm: async () => {
      if (!preview || saving || pending) return "failed";
      setSaving(true);
      try {
        return await session.saveRoutine(draft, preview, id);
      } catch {
        return "failed";
      } finally {
        setSaving(false);
      }
    },
  };
}
