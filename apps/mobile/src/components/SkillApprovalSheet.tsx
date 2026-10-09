import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { approvalFacts, Banner, Button, GroupCard, ICON, LineCompare, Row, RowList, scriptCheckLine, ScriptCode, useScriptCheck } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * The approval of one source on the phone (plan KI-Harness P3-5): the
 * desktop's dialog in the grammar of a sheet with rows — what it may do,
 * what changed, its instructions, files and origin, then "Approve" for
 * exactly what was shown.
 *
 * A script (plan P5.5, mockup chapter 21) is shown the same way, with what a
 * program adds: its limits, the inputs it asks for, and its code in full —
 * read by the engine first, so code that is no JavaScript is not approved.
 * Its approval is this device's signature; where the keychain gives no key
 * to sign with, the sheet says that nothing was approved.
 */
export function SkillApprovalSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [refusal, setRefusal] = useState<"changed" | "no-key" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const entry = state.skills.entries.find((e) => e.source.id === id) ?? null;
  const script = entry?.source.kind === "script";
  const check = useScriptCheck(session, script ? (entry?.source.code ?? null) : null);
  if (!entry) return null;
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
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-approval">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{facts.title}</p>
        <p className="m-hint">{t(`ai.workshop.status.${facts.status}`)}</p>
        {refusal && (
          <Banner kind={refusal === "changed" ? "warning" : "error"} testId="ai-skill-refusal">
            {refusal === "changed" ? t("ai.workshop.changedMeanwhile") : refusal === "no-key" ? t("ai.scripts.noKey") : t("ai.scripts.cannotApprove")}
          </Banner>
        )}
        <GroupCard>
          <RowList>
            {facts.may.length > 0 && <Row title={script ? t("ai.scripts.may") : t("ai.workshop.may")} subtitle={facts.may.join(script ? " " : " · ")} wrap />}
            {facts.rights && <Row title={t("ai.workshop.rights.title")} subtitle={facts.rights.join(" · ")} wrap data-testid="ai-skill-rights" />}
            {facts.limits && <Row title={t("ai.scripts.limits")} subtitle={facts.limits} wrap data-testid="ai-script-limits" />}
            {facts.inputs && <Row title={t("ai.scripts.input")} subtitle={facts.inputs.join(" · ")} wrap />}
            <Row title={t("ai.workshop.files")} subtitle={facts.files.map((f) => `${f.path} · ${f.size}`).join(" · ")} wrap />
            <Row title={t("ai.workshop.origin")} subtitle={facts.origin.join(" · ")} wrap />
          </RowList>
        </GroupCard>
        {changed && (
          <>
            <p className="m-hint">{t("ai.workshop.changes")}</p>
            {facts.changes ? <LineCompare lines={facts.changes} testId="ai-skill-changes" /> : <p className="m-hint">{t("ai.workshop.noChanges")}</p>}
          </>
        )}
        {facts.text !== null && !(changed && facts.changes) && (
          <>
            <p className="m-hint">{t("ai.workshop.instructions")}</p>
            <LineCompare lines={null} fallback={facts.text} testId="ai-skill-text" />
          </>
        )}
        {typeof facts.code === "string" && (
          <>
            <p className="m-hint">{t("ai.scripts.code")}</p>
            <ScriptCode code={facts.code} testId="ai-script-code" />
            {checked ? (
              <div className="m-skill-test-lines">
                <span className="pv-skill-test-line" data-mark={checked.mark} data-testid="ai-script-check">
                  {checked.mark === "pass" ? <Check size={ICON.meta} aria-hidden="true" /> : <X size={ICON.meta} aria-hidden="true" />}
                  <span>{checked.text}</span>
                </span>
              </div>
            ) : (
              facts.codeSize && <p className="m-hint">{facts.codeSize}</p>
            )}
          </>
        )}
        {facts.widened && (
          <Banner kind="warning" testId="ai-skill-wider">
            {t("ai.workshop.rights.widened")}
          </Banner>
        )}
        {facts.warnings.map((warning) => (
          <Banner key={warning} kind="warning">
            {warning}
          </Banner>
        ))}
        {facts.problems.length > 0 && <Banner kind="error">{facts.problems.join(" ")}</Banner>}
        {canApprove && (
          <>
            <p className="m-hint">{script ? t("ai.scripts.approvalHint") : t("ai.workshop.approvalHint")}</p>
            <Button variant="primary" disabled={busy} onClick={() => void approve()} data-testid="ai-skill-approve">
              {t("ai.workshop.approve")}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          {canApprove ? t("ai.workshop.notNow") : t("common.close")}
        </Button>
      </div>
    </div>
  );
}
