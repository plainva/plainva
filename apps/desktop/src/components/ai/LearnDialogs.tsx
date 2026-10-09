import { useTranslation } from "react-i18next";
import { GraduationCap, History } from "lucide-react";
import {
  approvalFacts,
  Banner,
  Button,
  closeLearnSurface,
  EmptyState,
  ICON,
  LearnDrafts,
  learnPlanFacts,
  learnRefusalText,
  learnResultFacts,
  learnSurfaceKey,
  LineCompare,
  Modal,
  Select,
  skillVersionLabel,
  TextArea,
  useAiSession,
  useAiState,
  useLearnFlow,
  useLearnSurfaces,
  useSkillDraftReview,
  useSkillVersions,
  workshopTitle,
  type AiSession,
  type AiState,
} from "@plainva/ui";

/**
 * Learning's dialogs on the desktop (plan KI-Harness P6-2, mockup chapter
 * 22), hosted in one place: the review of a conversation, a skill's draft
 * under review, a skill's earlier versions. They are opened from wherever a
 * conversation, a draft or a skill is shown; a skill's draft is reviewed
 * over the result it came from, and closing it leads back there.
 */
export function LearnDialogs({ onOpenPath }: { onOpenPath: (path: string) => void }) {
  const surfaces = useLearnSurfaces();
  const session = useAiSession();
  const state = useAiState();
  if (!session || !state) return null;
  return (
    <>
      {surfaces.map((surface) => {
        const close = () => closeLearnSurface(surface);
        const key = learnSurfaceKey(surface);
        if (surface.kind === "learn") return <LearnModal key={key} session={session} state={state} conversationId={surface.conversationId} onClose={close} onOpenPath={onOpenPath} />;
        if (surface.kind === "skill-draft") return <SkillDraftModal key={key} session={session} state={state} draftId={surface.draftId} onClose={close} />;
        return <SkillVersionsModal key={key} session={session} state={state} skillId={surface.skillId} onClose={close} />;
      })}
    </>
  );
}

interface DialogProps {
  session: AiSession;
  state: AiState;
  onClose: () => void;
}

const Lines = ({ lines }: { lines: readonly string[] }) => (
  <>
    {lines.map((line) => (
      <span key={line}>{line}</span>
    ))}
  </>
);

/**
 * "Learn from this conversation": what would go where, then the review —
 * started here, each time —, then what it proposes. The drafts stand in the
 * dialog and under "Open"; closing the dialog loses none of them.
 */
function LearnModal({ session, state, conversationId, onClose, onOpenPath }: DialogProps & { conversationId: string; onOpenPath: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const flow = useLearnFlow(session, conversationId);
  const plan = flow.plan?.ok ? flow.plan.plan : null;
  const facts = plan ? learnPlanFacts(t, plan, i18n.language) : null;
  const outcome = flow.outcome;
  const result = outcome?.kind === "learned" ? learnResultFacts(t, outcome, i18n.language) : null;
  const refusal = outcome?.kind === "refused" ? outcome : flow.plan && !flow.plan.ok ? flow.plan : null;
  const asking = !outcome && !flow.running;
  return (
    <Modal
      title={t("ai.learn.action")}
      icon={<GraduationCap size={ICON.ui} />}
      headerNote={plan?.title}
      size="lg"
      onClose={onClose}
      closeOnOverlay={!flow.running}
      testId="ai-learn"
      footer={
        flow.running ? (
          <Button variant="ghost" onClick={flow.stop} data-testid="ai-learn-stop">
            {t("ai.stop")}
          </Button>
        ) : asking && facts ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={flow.start} data-testid="ai-learn-start">
              {t("ai.learn.start")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {refusal && (
        <Banner kind={refusal.reason === "cancelled" ? "info" : "warning"} rounded testId="ai-learn-refused">
          {learnRefusalText(t, refusal)}
        </Banner>
      )}
      {flow.running && plan && (
        <p className="pv-modal-hint" role="status" data-testid="ai-learn-running">
          {t("ai.learn.running", { model: plan.model })}
        </p>
      )}
      {asking && facts && (
        <>
          <p className="pv-modal-hint">{t("ai.learn.ask.lead")}</p>
          <dl className="pv-skill-facts" data-testid="ai-learn-plan">
            <dt>{t("ai.learn.ask.to")}</dt>
            <dd>
              <span data-testid="ai-learn-recipient">{facts.recipient}</span>
            </dd>
            <dt>{t("ai.learn.ask.what")}</dt>
            <dd>
              <Lines lines={facts.goes} />
            </dd>
            <dt>{t("ai.learn.ask.comes")}</dt>
            <dd>
              <span data-testid="ai-learn-kinds">{facts.comes.join(" · ")}</span>
              <Lines lines={facts.limits} />
            </dd>
            <dt>{t("ai.learn.ask.size")}</dt>
            <dd>
              <span>{facts.estimate}</span>
            </dd>
          </dl>
          <p className="pv-modal-hint">{t("ai.learn.ask.nothingCounts")}</p>
        </>
      )}
      {result && outcome?.kind === "learned" && (
        <>
          <p className="pv-modal-hint" data-testid="ai-learn-lead">
            {result.lead}
          </p>
          {outcome.drafts.length > 0 ? (
            <LearnDrafts session={session} state={state} ids={outcome.drafts} onOpenNote={onOpenPath} />
          ) : (
            <div data-testid="ai-learn-none">
              <EmptyState icon={<GraduationCap size={ICON.empty} aria-hidden="true" />} title={t("ai.learn.result.none")}>
                {t("ai.learn.result.noneHint")}
              </EmptyState>
            </div>
          )}
          {result.notes.map((note) => (
            <p key={note} className="pv-modal-hint" data-testid="ai-learn-note">
              {note}
            </p>
          ))}
          <p className="pv-modal-hint" data-testid="ai-learn-usage">
            {result.usage}
          </p>
        </>
      )}
    </Modal>
  );
}

/**
 * A skill's draft before it is taken over (mockup chapter 22, step 5): what
 * changes, as a line comparison; what the skill may do, which a proposal
 * never changes; whether the new version is checked; where it comes from.
 * "Rework" turns the comparison into a field — what is typed there is what
 * "Take over" writes.
 */
function SkillDraftModal({ session, state, draftId, onClose }: DialogProps & { draftId: string }) {
  const { t } = useTranslation();
  const review = useSkillDraftReview(session, state, draftId, onClose);
  const { facts, change } = review;
  if (!facts || !change) return null;
  return (
    <Modal
      title={facts.title}
      icon={<GraduationCap size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-skill-draft"
      footer={
        <>
          <Button variant="ghost" disabled={review.busy} onClick={review.discard} data-testid="ai-skill-draft-discard">
            {t("ai.write.draft.discard")}
          </Button>
          <Button variant="ghost" onClick={review.editing ? review.compare : review.rework} data-testid="ai-skill-draft-rework">
            {t(review.editing ? "ai.learn.review.compare" : "ai.learn.review.rework")}
          </Button>
          <Button variant="primary" disabled={!review.canTake} onClick={review.take} data-testid="ai-skill-draft-take">
            {t("ai.learn.review.take")}
          </Button>
        </>
      }
    >
      {(review.refusal ?? facts.blocked) && (
        <Banner kind="warning" rounded testId="ai-skill-draft-blocked">
          {review.refusal ?? facts.blocked}
        </Banner>
      )}
      <dl className="pv-skill-facts">
        {facts.description !== null && (
          <>
            <dt>{t("ai.learn.review.purpose")}</dt>
            <dd>
              <span data-testid="ai-skill-draft-purpose">{facts.description}</span>
            </dd>
          </>
        )}
        <dt>{t(facts.change ? "ai.learn.review.changes" : "ai.workshop.instructions")}</dt>
        <dd>
          {review.editing ? (
            <>
              <TextArea rows={12} value={review.body} aria-label={t("ai.workshop.instructions")} onChange={(event) => review.setBody(event.target.value)} data-testid="ai-skill-draft-body" />
              <span>{t("ai.learn.review.reworkHint")}</span>
            </>
          ) : change.lines ? (
            <LineCompare lines={change.lines} testId="ai-skill-draft-changes" />
          ) : (
            <LineCompare lines={null} fallback={review.body} testId="ai-skill-draft-text" />
          )}
        </dd>
        <dt>{t("ai.workshop.may")}</dt>
        <dd data-testid="ai-skill-draft-rights">
          {facts.unchanged && <span>{facts.unchanged}</span>}
          <Lines lines={facts.may} />
          <span>{facts.mayNote}</span>
        </dd>
        {facts.tested.length > 0 && (
          <>
            <dt>{t("ai.learn.review.check")}</dt>
            <dd data-testid="ai-skill-draft-tested">
              <Lines lines={facts.tested} />
            </dd>
          </>
        )}
        <dt>{t("ai.learn.review.cost")}</dt>
        <dd>
          <span data-testid="ai-skill-draft-cost">{change.cost}</span>
        </dd>
        <dt>{t("ai.workshop.origin")}</dt>
        <dd>
          <Lines lines={facts.origin} />
          {facts.why && <span data-testid="ai-skill-draft-why">{facts.why}</span>}
        </dd>
      </dl>
      <p className="pv-modal-hint">{facts.hint}</p>
    </Modal>
  );
}

/**
 * A skill's earlier versions (mockup chapter 22, step 8): what the vault's
 * history keeps of its file, the chosen one held against the skill as it is
 * now — its lines, and what it may do —, and the way back.
 */
function SkillVersionsModal({ session, state, skillId, onClose }: DialogProps & { skillId: string }) {
  const { t, i18n } = useTranslation();
  const entry = state.skills.entries.find((candidate) => candidate.source.id === skillId) ?? null;
  const history = useSkillVersions(session, entry, onClose);
  if (!entry) return null;
  const now = approvalFacts(t, entry, i18n.language).origin;
  const { facts } = history;
  return (
    <Modal
      title={t("ai.learn.versions.title", { name: workshopTitle(t, entry) })}
      icon={<History size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-skill-versions"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" disabled={!history.canRestore} onClick={history.restore} data-testid="ai-skill-version-restore">
            {t("ai.learn.versions.restore")}
          </Button>
        </>
      }
    >
      {history.refusal && (
        <Banner kind="warning" rounded testId="ai-skill-version-refused">
          {history.refusal}
        </Banner>
      )}
      {/* One list for every row: the labels share a column, so the values share an edge. */}
      <dl className="pv-skill-facts">
        <dt>{t("ai.learn.versions.now")}</dt>
        <dd data-testid="ai-skill-version-now">
          <Lines lines={now} />
        </dd>
        {history.versions !== null && history.versions.length > 0 && (
          <>
            <dt>{t("ai.learn.versions.earlier")}</dt>
            <dd data-testid="ai-skill-version-pick">
              <Select
                ariaLabel={t("ai.learn.versions.earlier")}
                minWidth={260}
                value={history.chosen ?? ""}
                onChange={history.choose}
                options={history.versions.map((version) => ({ value: version.id, label: skillVersionLabel(t, version.at, i18n.language) }))}
              />
            </dd>
          </>
        )}
        {facts && (
          <>
            <dt>{t("ai.learn.versions.against")}</dt>
            <dd>
              {facts.same ? <span data-testid="ai-skill-version-same">{t("ai.learn.versions.same")}</span> : <LineCompare lines={facts.changes} fallback={history.text} testId="ai-skill-version-changes" />}
            </dd>
            <dt>{t("ai.workshop.may")}</dt>
            <dd data-testid="ai-skill-version-rights">{facts.rights.length ? <Lines lines={facts.rights} /> : <span>{t("ai.learn.versions.rightsSame")}</span>}</dd>
          </>
        )}
      </dl>
      {history.versions === null ? null : history.versions.length === 0 ? (
        <div data-testid="ai-skill-versions-empty">
          <EmptyState icon={<History size={ICON.empty} aria-hidden="true" />} title={t(history.none ? "ai.learn.versions.none" : "ai.learn.versions.empty")}>
            {t("ai.learn.versions.emptyHint")}
          </EmptyState>
        </div>
      ) : (
        <>
          {facts?.widened && (
            <Banner kind="warning" rounded testId="ai-skill-version-wider">
              {t("ai.learn.versions.wider")}
            </Banner>
          )}
          {facts?.blocked && (
            <Banner kind="error" rounded>
              {facts.blocked}
            </Banner>
          )}
          <p className="pv-modal-hint">{t("ai.learn.versions.hint")}</p>
        </>
      )}
    </Modal>
  );
}
