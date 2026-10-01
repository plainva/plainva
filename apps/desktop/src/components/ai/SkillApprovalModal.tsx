import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import { approvalFacts, Banner, Button, ICON, LineCompare, Modal, useAiSession, useAiState } from "@plainva/ui";

/**
 * One source before it may run on this device (plan KI-Harness P3-5, §14.3):
 * what it may do in words, what changed since the approved version, its
 * instructions, its files and where it lies. "Approve" binds exactly the
 * files shown; when they changed while the dialog was open, nothing is
 * approved and it says so. For the app's own skills the same view, without
 * an approval: they come with the app.
 */
export function SkillApprovalModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = state?.skills.entries.find((e) => e.source.id === id) ?? null;
  if (!session || !entry) return null;
  const facts = approvalFacts(t, entry, i18n.language);
  const changed = facts.status === "changed";
  const approve = async () => {
    setBusy(true);
    const ok = await session.approveInstruction(id, facts.seen);
    setBusy(false);
    if (ok) onClose();
    else setStale(true);
  };
  return (
    <Modal
      title={facts.title}
      icon={<ScrollText size={ICON.ui} />}
      headerNote={t(`ai.workshop.status.${facts.status}`)}
      size="lg"
      onClose={onClose}
      testId="ai-skill-approval"
      footer={
        facts.canApprove ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("ai.workshop.notNow")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void approve()} data-testid="ai-skill-approve">
              {t("ai.workshop.approve")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {stale && (
        <Banner kind="warning" rounded>
          {t("ai.workshop.changedMeanwhile")}
        </Banner>
      )}
      <dl className="pv-skill-facts">
        {facts.may.length > 0 && (
          <>
            <dt>{t("ai.workshop.may")}</dt>
            <dd>
              {facts.may.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {changed && (
          <>
            <dt>{t("ai.workshop.changes")}</dt>
            <dd>{facts.changes ? <LineCompare lines={facts.changes} testId="ai-skill-changes" /> : <span>{t("ai.workshop.noChanges")}</span>}</dd>
          </>
        )}
        {facts.text !== null && !(changed && facts.changes) && (
          <>
            <dt>{t("ai.workshop.instructions")}</dt>
            <dd>
              <LineCompare lines={null} fallback={facts.text} testId="ai-skill-text" />
            </dd>
          </>
        )}
        <dt>{t("ai.workshop.files")}</dt>
        <dd>
          {facts.files.map((file) => (
            <span key={file.path}>
              <code>{file.path}</code> · {file.size}
            </span>
          ))}
        </dd>
        <dt>{t("ai.workshop.origin")}</dt>
        <dd>
          {facts.origin.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
      </dl>
      {facts.warnings.map((warning) => (
        <Banner key={warning} kind="warning" rounded>
          {warning}
        </Banner>
      ))}
      {facts.problems.length > 0 && (
        <Banner kind="error" rounded>
          {facts.problems.join(" ")}
        </Banner>
      )}
      {facts.canApprove && <p className="pv-modal-note">{t("ai.workshop.approvalHint")}</p>}
    </Modal>
  );
}
