import { useEffect, useState } from "react";
import { Check, Minus, X } from "lucide-react";
import { SKILL_TEST_DEFAULT_COST_USD } from "@plainva/core";
import { ICON } from "../lib/iconSizes";
import type { AiSession, AiState, SkillTestOutcome, SkillTestPlan } from "./aiSession";
import type { SkillTestLine } from "./skillsWorkshop";

/**
 * The regression run of the skills in the workshop (plan KI-Harness P3-8,
 * mockup chapter 12): what both shells share beyond the model in
 * `skillsWorkshop.ts` — the plan as it is now, the run with its ceiling, and
 * a scenario's verdict as a line. The desktop puts them into a `Modal`, the
 * phone into a sheet.
 */

/**
 * What a regression run of all skills would do, read again whenever the
 * skills, the chosen model or the settings change. Null while it is being
 * read, or where the AI cannot run. The workshop holds it and hands the
 * dialog its part (`skillTestPlanFor`): the dialog opens with its facts in
 * place.
 */
export function useSkillTestPlan(session: AiSession | null, state: AiState | null): SkillTestPlan | null {
  const [plan, setPlan] = useState<SkillTestPlan | null>(null);
  const entries = state?.skills.entries;
  const draft = state?.draftChoice;
  const settings = state?.settings;
  const hasVault = state?.hasVault;
  useEffect(() => {
    let current = true;
    void (session ? session.skillTestPlan() : Promise.resolve(null))
      .catch(() => null)
      .then((next) => {
        if (current) setPlan(next);
      });
    return () => {
      current = false;
    };
  }, [session, entries, draft, settings, hasVault]);
  return plan;
}

/** The amount the dialog's field holds, as a ceiling: a positive number, or the default when it does not read. */
export function skillTestCeiling(input: string): number {
  const value = Number(input.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : SKILL_TEST_DEFAULT_COST_USD;
}

/**
 * Starts a regression run and keeps what came of it. A model on this device
 * has no ceiling: nothing leaves it and nothing is billed.
 */
export function useSkillTestRun(session: AiSession | null): {
  outcome: SkillTestOutcome | null;
  busy: boolean;
  start(plan: SkillTestPlan, ids: readonly string[] | null, amount: string): void;
} {
  const [outcome, setOutcome] = useState<SkillTestOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const start = (plan: SkillTestPlan, ids: readonly string[] | null, amount: string) => {
    if (!session || busy) return;
    setBusy(true);
    setOutcome(null);
    void session
      .testSkills(ids, plan.local ? { maxCostUsd: null, maxTokens: Number.MAX_SAFE_INTEGER } : { maxCostUsd: plan.priced ? skillTestCeiling(amount) : null })
      .then(setOutcome)
      .finally(() => setBusy(false));
  };
  return { outcome, busy, start };
}

/** The scenarios of one skill with their verdicts: a mark and words. */
export function SkillTestLines({ lines }: { lines: readonly SkillTestLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line.id} className="pv-skill-test-line" data-mark={line.mark} data-testid="ai-skill-test-line">
          {line.mark === "pass" ? <Check size={ICON.meta} aria-hidden="true" /> : line.mark === "fail" ? <X size={ICON.meta} aria-hidden="true" /> : <Minus size={ICON.meta} aria-hidden="true" />}
          <span>
            <code>{line.id}</code> — {line.text}
          </span>
        </span>
      ))}
    </>
  );
}
