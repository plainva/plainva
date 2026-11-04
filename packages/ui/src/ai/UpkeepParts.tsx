import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AiSession, AiState, SkillTestPlan } from "./aiSession";
import { openLearnSurface } from "./aiLearn";
import { upkeepRows, type UpkeepRow, type UpkeepStep } from "./upkeepView";

/**
 * Upkeep, as far as both shells share it (plan KI-Harness P6-3, mockup
 * chapter 22, step 7): the hints of one view as rows, kept current, and what
 * a hint's step does where the step is the same in both shells. The desktop
 * draws the rows as a card, the phone as a group; the dialogs a step opens
 * are each shell's own.
 */

/**
 * The hints of the skills (`area` "skills") or of the memory, as rows. They
 * are recomputed when the view opens and whenever what they are computed
 * from changes — the instructions, the regression results, the memory, the
 * history. `plan`: the regression plan the workshop holds; the memory's view
 * leaves it out.
 */
export function useUpkeepRows(session: AiSession | null, state: AiState | null, area: "skills" | "memory", plan?: SkillTestPlan | null): UpkeepRow[] {
  const { t, i18n } = useTranslation();
  const entries = state?.skills.entries;
  const records = state?.skillTests.records;
  const memory = state?.memory;
  const conversations = state?.summaries.length;
  useEffect(() => {
    void session?.refreshUpkeep(plan);
  }, [session, entries, records, memory, conversations, plan]);
  const hints = state ? state.upkeep[area] : null;
  return useMemo(
    () => (hints && entries && memory ? upkeepRows(t, hints, { entries, memory, language: i18n.language }) : []),
    // The translator changes with the language; the rows are words.
    [t, i18n.language, hints, entries, memory],
  );
}

/**
 * What a step does where both shells do the same: a review of a conversation
 * opens learning's own dialog — which asks before anything is sent —, and
 * switching a skill off is the switch of its row. True when the step was
 * taken here; the shell does the rest (a dialog of its own, a file to open).
 */
export function takeSharedUpkeepStep(session: AiSession, step: UpkeepStep): boolean {
  if (step.do === "learn") {
    openLearnSurface({ kind: "learn", conversationId: step.conversationId });
    return true;
  }
  if (step.do === "switch-off") {
    void session.switchInstruction(step.id, false);
    return true;
  }
  return false;
}
