import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, History } from "lucide-react";
import {
  approvalFacts,
  Banner,
  Button,
  closeLearnSurface,
  EmptyState,
  GroupCard,
  ICON,
  LearnDrafts,
  learnPlanFacts,
  learnRefusalText,
  learnResultFacts,
  learnSurfaceKey,
  LineCompare,
  Row,
  RowList,
  skillVersionLabel,
  TextArea,
  useLearnFlow,
  useLearnSurfaces,
  useSkillDraftReview,
  useSkillVersions,
  workshopTitle,
  type AiSession,
  type AiState,
} from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * Learning's sheets on the phone (plan KI-Harness P6-2, mockup chapter 22) —
 * the desktop's dialogs in the grammar of a sheet with rows, hosted in one
 * place: the review of a conversation, a skill's draft under review, a
 * skill's earlier versions. What each of them does is shared
 * (`useLearnFlow`, `useSkillDraftReview`, `useSkillVersions`); nothing here
 * decides on its own.
 */
export function LearnSheets({ onOpenNote }: { onOpenNote: (path: string) => void }) {
  const surfaces = useLearnSurfaces();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return (
    <>
      {surfaces.map((surface) => {
        const close = () => closeLearnSurface(surface);
        const key = learnSurfaceKey(surface);
        if (surface.kind === "learn") return <LearnSheet key={key} session={session} state={state} conversationId={surface.conversationId} onClose={close} onOpenNote={onOpenNote} />;
        if (surface.kind === "skill-draft") return <SkillDraftSheet key={key} session={session} state={state} draftId={surface.draftId} onClose={close} />;
        return <SkillVersionsSheet key={key} session={session} state={state} skillId={surface.skillId} onClose={close} />;
      })}
    </>
  );
}

interface SheetProps {
  session: AiSession;
  state: AiState;
  onClose: () => void;
}

/** "Learn from this conversation": what would go where, then the review — started here, each time —, then what it proposes. */
function LearnSheet({ session, state, conversationId, onClose, onOpenNote }: SheetProps & { conversationId: string; onOpenNote: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const flow = useLearnFlow(session, conversationId);
  const plan = flow.plan?.ok ? flow.plan.plan : null;
  const facts = plan ? learnPlanFacts(t, plan, i18n.language) : null;
  const outcome = flow.outcome;
  const result = outcome?.kind === "learned" ? learnResultFacts(t, outcome, i18n.language) : null;
  const refusal = outcome?.kind === "refused" ? outcome : flow.plan && !flow.plan.ok ? flow.plan : null;
  const asking = !outcome && !flow.running;
  // While the review runs, the sheet stays: a tap beside it would leave a request nobody is looking at.
  const dismiss = flow.running ? undefined : onClose;
  return (
    <div className="m-sheet-backdrop" onClick={dismiss}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-learn">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.learn.action")}</p>
        {plan && <p className="m-hint">{plan.title}</p>}
        {refusal && (
          <Banner kind={refusal.reason === "cancelled" ? "info" : "warning"} testId="ai-learn-refused">
            {learnRefusalText(t, refusal)}
          </Banner>
        )}
        {flow.running && plan && (
          <p className="m-hint" role="status" data-testid="ai-learn-running">
            {t("ai.learn.running", { model: plan.model })}
          </p>
        )}
        {asking && facts && (
          <>
            <p className="m-hint">{t("ai.learn.ask.lead")}</p>
            <GroupCard>
              <RowList>
                <Row title={t("ai.learn.ask.to")} subtitle={facts.recipient} wrap data-testid="ai-learn-recipient" />
                <Row title={t("ai.learn.ask.what")} subtitle={facts.goes.join(" ")} wrap />
                <Row title={t("ai.learn.ask.comes")} subtitle={[facts.comes.join(" · "), ...facts.limits].join(" ")} wrap data-testid="ai-learn-kinds" />
                <Row title={t("ai.learn.ask.size")} subtitle={facts.estimate} wrap />
              </RowList>
            </GroupCard>
            <p className="m-hint">{t("ai.learn.ask.nothingCounts")}</p>
            <Button variant="primary" onClick={flow.start} data-testid="ai-learn-start">
              {t("ai.learn.start")}
            </Button>
          </>
        )}
        {result && outcome?.kind === "learned" && (
          <>
            <p className="m-hint" data-testid="ai-learn-lead">
              {result.lead}
            </p>
            {outcome.drafts.length > 0 ? (
              <LearnDrafts session={session} state={state} ids={outcome.drafts} onOpenNote={onOpenNote} touch />
            ) : (
              <div data-testid="ai-learn-none">
                <EmptyState icon={<GraduationCap size={ICON.empty} aria-hidden="true" />} title={t("ai.learn.result.none")}>
                  {t("ai.learn.result.noneHint")}
                </EmptyState>
              </div>
            )}
            {result.notes.map((note) => (
              <p key={note} className="m-hint" data-testid="ai-learn-note">
                {note}
              </p>
            ))}
            <p className="m-hint" data-testid="ai-learn-usage">
              {result.usage}
            </p>
          </>
        )}
        {flow.running ? (
          <Button variant="ghost" onClick={flow.stop} data-testid="ai-learn-stop">
            {t("ai.stop")}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t(asking && facts ? "common.cancel" : "common.close")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A skill's draft before it is taken over: what changes, what the skill may do — which a proposal never changes —, and where it comes from. */
function SkillDraftSheet({ session, state, draftId, onClose }: SheetProps & { draftId: string }) {
  const { t } = useTranslation();
  const review = useSkillDraftReview(session, state, draftId, onClose);
  const { facts, change } = review;
  if (!facts || !change) return null;
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-draft">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{facts.title}</p>
        {(review.refusal ?? facts.blocked) && (
          <Banner kind="warning" testId="ai-skill-draft-blocked">
            {review.refusal ?? facts.blocked}
          </Banner>
        )}
        {facts.description !== null && (
          <p className="m-hint" data-testid="ai-skill-draft-purpose">
            {facts.description}
          </p>
        )}
        <p className="m-hint">{t(facts.change ? "ai.learn.review.changes" : "ai.workshop.instructions")}</p>
        {review.editing ? (
          <>
            <TextArea rows={10} value={review.body} aria-label={t("ai.workshop.instructions")} onChange={(event) => review.setBody(event.target.value)} data-testid="ai-skill-draft-body" />
            <p className="m-hint">{t("ai.learn.review.reworkHint")}</p>
          </>
        ) : change.lines ? (
          <LineCompare lines={change.lines} testId="ai-skill-draft-changes" />
        ) : (
          <LineCompare lines={null} fallback={review.body} testId="ai-skill-draft-text" />
        )}
        <GroupCard>
          <RowList>
            <Row title={t("ai.workshop.may")} subtitle={`${facts.unchanged ? `${facts.unchanged} ` : ""}${facts.may.join(" · ")}`} wrap data-testid="ai-skill-draft-rights" />
            {facts.tested.length > 0 && <Row title={t("ai.learn.review.check")} subtitle={facts.tested.join(" ")} wrap data-testid="ai-skill-draft-tested" />}
            <Row title={t("ai.learn.review.cost")} subtitle={change.cost} wrap data-testid="ai-skill-draft-cost" />
            <Row title={t("ai.workshop.origin")} subtitle={[...facts.origin, ...(facts.why ? [facts.why] : [])].join(" · ")} wrap data-testid="ai-skill-draft-why" />
          </RowList>
        </GroupCard>
        <p className="m-hint">{facts.mayNote}</p>
        <p className="m-hint">{facts.hint}</p>
        <Button variant="primary" disabled={!review.canTake} onClick={review.take} data-testid="ai-skill-draft-take">
          {t("ai.learn.review.take")}
        </Button>
        <Button variant="secondary" onClick={review.editing ? review.compare : review.rework} data-testid="ai-skill-draft-rework">
          {t(review.editing ? "ai.learn.review.compare" : "ai.learn.review.rework")}
        </Button>
        <Button variant="ghost" disabled={review.busy} onClick={review.discard} data-testid="ai-skill-draft-discard">
          {t("ai.write.draft.discard")}
        </Button>
      </div>
    </div>
  );
}

/** A skill's earlier versions: what the vault's history keeps of its file, the chosen one against the skill as it is now, and the way back. */
function SkillVersionsSheet({ session, state, skillId, onClose }: SheetProps & { skillId: string }) {
  const { t, i18n } = useTranslation();
  const entry = state.skills.entries.find((candidate) => candidate.source.id === skillId) ?? null;
  const history = useSkillVersions(session, entry, onClose);
  if (!entry) return null;
  const now = approvalFacts(t, entry, i18n.language).origin;
  const { facts } = history;
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-versions">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.learn.versions.title", { name: workshopTitle(t, entry) })}</p>
        <p className="m-hint" data-testid="ai-skill-version-now">
          {`${t("ai.learn.versions.now")}: ${now.join(" · ")}`}
        </p>
        {history.refusal && (
          <Banner kind="warning" testId="ai-skill-version-refused">
            {history.refusal}
          </Banner>
        )}
        {history.versions === null ? null : history.versions.length === 0 ? (
          <div data-testid="ai-skill-versions-empty">
            <EmptyState icon={<History size={ICON.empty} aria-hidden="true" />} title={t(history.none ? "ai.learn.versions.none" : "ai.learn.versions.empty")}>
              {t("ai.learn.versions.emptyHint")}
            </EmptyState>
          </div>
        ) : (
          <>
            <GroupCard>
              <RowList>
                {history.versions.map((version) => (
                  <Row key={version.id} title={skillVersionLabel(t, version.at, i18n.language)} current={history.chosen === version.id} onClick={() => history.choose(version.id)} data-testid="ai-skill-version" />
                ))}
              </RowList>
            </GroupCard>
            {facts && (
              <>
                <p className="m-hint">{t("ai.learn.versions.against")}</p>
                {facts.same ? (
                  <p className="m-hint" data-testid="ai-skill-version-same">
                    {t("ai.learn.versions.same")}
                  </p>
                ) : (
                  <LineCompare lines={facts.changes} fallback={history.text} testId="ai-skill-version-changes" />
                )}
                <GroupCard>
                  <RowList>
                    <Row title={t("ai.workshop.may")} subtitle={facts.rights.length ? facts.rights.join(" · ") : t("ai.learn.versions.rightsSame")} wrap data-testid="ai-skill-version-rights" />
                  </RowList>
                </GroupCard>
              </>
            )}
            {facts?.widened && (
              <Banner kind="warning" testId="ai-skill-version-wider">
                {t("ai.learn.versions.wider")}
              </Banner>
            )}
            {facts?.blocked && <Banner kind="error">{facts.blocked}</Banner>}
            <p className="m-hint">{t("ai.learn.versions.hint")}</p>
            <Button variant="primary" disabled={!history.canRestore} onClick={history.restore} data-testid="ai-skill-version-restore">
              {t("ai.learn.versions.restore")}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
