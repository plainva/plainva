import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { SKILL_TEST_DEFAULT_COST_USD } from "@plainva/core";
import { Banner, Button, ICON, Modal, skillTestFacts, skillTestGroups, SkillTestLines, skillTestOutcomeText, TextInput, useAiSession, useAiState, useSkillTestRun, type SkillTestPlan } from "@plainva/ui";

/**
 * The regression run of the skills (plan KI-Harness P3-8, mockup chapter 12):
 * before it starts, what would run against which model and where it ends;
 * while it runs, the scenario it is at and a way to stop; afterwards, each
 * scenario's verdict in words. Started by hand only. `ids` narrows it to some
 * skills; null means every active skill that brings scenarios, and `plan` is
 * the workshop's plan for exactly those. The words come from
 * `skillsWorkshop.ts` and are the phone's as well.
 */
export function SkillTestModal({ ids, plan, onClose }: { ids: readonly string[] | null; plan: SkillTestPlan | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const run = useSkillTestRun(session);
  const [amount, setAmount] = useState(String(SKILL_TEST_DEFAULT_COST_USD));
  if (!session || !state) return null;
  const facts = plan ? skillTestFacts(t, plan, i18n.language) : null;
  const running = state.skillTests.running;
  const groups = skillTestGroups(t, state.skills.entries, state.skillTests.records, ids, i18n.language);
  const outcome = run.outcome && plan ? skillTestOutcomeText(t, run.outcome, plan.providerLabel) : null;
  return (
    <Modal
      title={plan ? t("ai.workshop.test.run", { model: plan.choice.model }) : t("ai.workshop.test.title")}
      icon={<FlaskConical size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-skill-test"
      footer={
        run.busy ? (
          <Button variant="ghost" onClick={() => session.stop()} data-testid="ai-skill-test-stop">
            {t("ai.stop")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button variant="primary" disabled={!plan || !facts?.canRun} onClick={() => plan && run.start(plan, ids, amount)} data-testid="ai-skill-test-start">
              {t("ai.workshop.test.start")}
            </Button>
          </>
        )
      }
    >
      {facts && (
        <dl className="pv-skill-facts">
          <dt>{t("ai.workshop.test.model")}</dt>
          <dd>
            <span>{facts.model}</span>
          </dd>
          <dt>{t("ai.workshop.test.what")}</dt>
          <dd>
            <span data-testid="ai-skill-test-scope">{facts.scope}</span>
            {facts.elsewhere && <span>{facts.elsewhere}</span>}
          </dd>
          <dt>{t("ai.workshop.test.ceiling")}</dt>
          <dd>
            {facts.ceiling ? (
              <span>{facts.ceiling}</span>
            ) : (
              <>
                <TextInput value={amount} inputMode="decimal" disabled={run.busy} aria-label={t("ai.workshop.test.ceilingAmount")} onChange={(event) => setAmount(event.target.value)} data-testid="ai-skill-test-ceiling" />
                <span>{t("ai.workshop.test.ceilingHint")}</span>
              </>
            )}
          </dd>
        </dl>
      )}
      <p className="pv-modal-hint">{t("ai.workshop.test.how")}</p>
      {running && (
        <Banner kind="info" rounded>
          {t("ai.workshop.test.progress", { done: running.done + 1, total: running.total, scenario: running.scenario })}
        </Banner>
      )}
      {outcome && (
        <Banner kind={outcome.tone} rounded>
          {outcome.text}
        </Banner>
      )}
      {groups.length > 0 && (
        <dl className="pv-skill-facts" data-testid="ai-skill-test-results">
          {groups.map((group) => (
            <Fragment key={group.id}>
              <dt>{group.title}</dt>
              <dd>
                <span>{group.note}</span>
                <SkillTestLines lines={group.lines} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Modal>
  );
}
