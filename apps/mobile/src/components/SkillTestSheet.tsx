import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SKILL_TEST_DEFAULT_COST_USD } from "@plainva/core";
import { Banner, Button, GroupCard, Row, RowList, skillTestFacts, skillTestGroups, SkillTestLines, skillTestOutcomeText, TextInput, useSkillTestRun, type SkillTestPlan } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * The regression run of the skills on the phone (plan KI-Harness P3-8): the
 * desktop's dialog in the grammar of a sheet — what would run against which
 * model and where it ends, the scenario it is at with a way to stop, then
 * each scenario's verdict in words. The model (`skillTestFacts`,
 * `skillTestGroups`) is shared, and `plan` is the workshop's plan for the
 * skills in `ids`; nothing here decides on its own.
 */
export function SkillTestSheet({ ids, plan, onClose }: { ids: readonly string[] | null; plan: SkillTestPlan | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const run = useSkillTestRun(session);
  const [amount, setAmount] = useState(String(SKILL_TEST_DEFAULT_COST_USD));
  const facts = plan ? skillTestFacts(t, plan, i18n.language) : null;
  const running = state.skillTests.running;
  const groups = skillTestGroups(t, state.skills.entries, state.skillTests.records, ids, i18n.language);
  const outcome = run.outcome && plan ? skillTestOutcomeText(t, run.outcome, plan.providerLabel) : null;
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-test">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{plan ? t("ai.workshop.test.run", { model: plan.choice.model }) : t("ai.workshop.test.title")}</p>
        {facts && (
          <GroupCard>
            <RowList>
              <Row title={t("ai.workshop.test.model")} subtitle={facts.model} wrap />
              <Row title={t("ai.workshop.test.what")} subtitle={facts.scope} wrap data-testid="ai-skill-test-scope" />
              {facts.ceiling && <Row title={t("ai.workshop.test.ceiling")} subtitle={facts.ceiling} wrap />}
            </RowList>
          </GroupCard>
        )}
        {facts?.elsewhere && <p className="m-hint">{facts.elsewhere}</p>}
        {facts && !facts.ceiling && (
          <>
            <label className="m-field">
              <span>{t("ai.workshop.test.ceiling")}</span>
              <TextInput value={amount} inputMode="decimal" disabled={run.busy} aria-label={t("ai.workshop.test.ceilingAmount")} onChange={(event) => setAmount(event.target.value)} data-testid="ai-skill-test-ceiling" />
            </label>
            <p className="m-hint">{t("ai.workshop.test.ceilingHint")}</p>
          </>
        )}
        <p className="m-hint">{t("ai.workshop.test.how")}</p>
        {running && <Banner kind="info">{t("ai.workshop.test.progress", { done: running.done + 1, total: running.total, scenario: running.scenario })}</Banner>}
        {outcome && <Banner kind={outcome.tone}>{outcome.text}</Banner>}
        {groups.map((group) => (
          <GroupCard key={group.id}>
            <RowList>
              <Row title={group.title} subtitle={group.note} wrap />
            </RowList>
            <div className="m-skill-test-lines" data-testid="ai-skill-test-results">
              <SkillTestLines lines={group.lines} />
            </div>
          </GroupCard>
        ))}
        {run.busy ? (
          <Button variant="ghost" onClick={() => session.stop()} data-testid="ai-skill-test-stop">
            {t("ai.stop")}
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={!plan || !facts?.canRun} onClick={() => plan && run.start(plan, ids, amount)} data-testid="ai-skill-test-start">
              {t("ai.workshop.test.start")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
