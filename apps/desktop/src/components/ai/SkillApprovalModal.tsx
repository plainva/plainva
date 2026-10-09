import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CodeXml, ScrollText, X } from "lucide-react";
import { approvalFacts, Banner, Button, ICON, LineCompare, Modal, scriptCheckLine, ScriptCode, useAiSession, useAiState, useScriptCheck } from "@plainva/ui";

/**
 * One source before it may run on this device (plan KI-Harness P3-5, §14.3):
 * what it may do in words, what changed since the approved version, its
 * instructions, its files and where it lies. "Approve" binds exactly the
 * files shown; when they changed while the dialog was open, nothing is
 * approved and it says so. For the app's own skills the same view, without
 * an approval: they come with the app.
 *
 * A script (plan P5.5, mockup chapter 21) is shown the same way, with what a
 * program adds: its limits, the inputs it asks for, and its code in full —
 * read by the engine first, so code that is no JavaScript is not approved.
 * Its approval is this device's signature; where the keychain gives no key
 * to sign with, the dialog says that nothing was approved.
 */
export function SkillApprovalModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [refusal, setRefusal] = useState<"changed" | "no-key" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const entry = state?.skills.entries.find((e) => e.source.id === id) ?? null;
  const script = entry?.source.kind === "script";
  const check = useScriptCheck(session, script ? (entry?.source.code ?? null) : null);
  if (!session || !entry) return null;
  const facts = approvalFacts(t, entry, i18n.language);
  const checked = check ? scriptCheckLine(t, check, facts.codeSize) : null;
  const changed = facts.status === "changed";
  // Code the engine does not read is not approved: there would be nothing to run.
  const canApprove = facts.canApprove && !(check && !check.ok);
  const approve = async () => {
    setBusy(true);
    const refused = await session.approveSource(id, facts.seen);
    setBusy(false);
    if (refused === null) onClose();
    else setRefusal(refused);
  };
  return (
    <Modal
      title={facts.title}
      icon={script ? <CodeXml size={ICON.ui} /> : <ScrollText size={ICON.ui} />}
      headerNote={t(`ai.workshop.status.${facts.status}`)}
      size="lg"
      onClose={onClose}
      testId="ai-skill-approval"
      footer={
        canApprove ? (
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
      {refusal && (
        <Banner kind={refusal === "changed" ? "warning" : "error"} rounded testId="ai-skill-refusal">
          {refusal === "changed" ? t("ai.workshop.changedMeanwhile") : refusal === "no-key" ? t("ai.scripts.noKey") : t("ai.scripts.cannotApprove")}
        </Banner>
      )}
      <dl className="pv-skill-facts">
        {facts.may.length > 0 && (
          <>
            <dt>{script ? t("ai.scripts.may") : t("ai.workshop.may")}</dt>
            <dd>
              {facts.may.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {facts.limits && (
          <>
            <dt>{t("ai.scripts.limits")}</dt>
            <dd>
              <span data-testid="ai-script-limits">{facts.limits}</span>
            </dd>
          </>
        )}
        {facts.inputs && (
          <>
            <dt>{t("ai.scripts.input")}</dt>
            <dd>
              {facts.inputs.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {facts.rights && (
          <>
            <dt>{t("ai.workshop.rights.title")}</dt>
            <dd data-testid="ai-skill-rights">
              {facts.rights.map((line) => (
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
        {typeof facts.code === "string" && (
          <>
            <dt>{t("ai.scripts.code")}</dt>
            <dd>
              <ScriptCode code={facts.code} testId="ai-script-code" />
              {checked ? (
                <span className="pv-skill-test-line" data-mark={checked.mark} data-testid="ai-script-check">
                  {checked.mark === "pass" ? <Check size={ICON.meta} aria-hidden="true" /> : <X size={ICON.meta} aria-hidden="true" />}
                  <span>{checked.text}</span>
                </span>
              ) : (
                facts.codeSize && <span>{facts.codeSize}</span>
              )}
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
      {facts.widened && (
        <Banner kind="warning" rounded testId="ai-skill-wider">
          {t("ai.workshop.rights.widened")}
        </Banner>
      )}
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
      {canApprove && <p className="pv-modal-hint">{script ? t("ai.scripts.approvalHint") : t("ai.workshop.approvalHint")}</p>}
    </Modal>
  );
}
