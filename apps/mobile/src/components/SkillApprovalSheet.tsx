import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { approvalFacts, Banner, Button, GroupCard, LineCompare, Row, RowList } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * The approval of one source on the phone (plan KI-Harness P3-5): the
 * desktop's dialog in the grammar of a sheet with rows — what it may do,
 * what changed, its instructions, files and origin, then "Approve" for
 * exactly what was shown.
 */
export function SkillApprovalSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const entry = state.skills.entries.find((e) => e.source.id === id) ?? null;
  if (!entry) return null;
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
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-approval">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{facts.title}</p>
        <p className="m-hint">{t(`ai.workshop.status.${facts.status}`)}</p>
        {stale && <Banner kind="warning">{t("ai.workshop.changedMeanwhile")}</Banner>}
        <GroupCard>
          <RowList>
            {facts.may.length > 0 && <Row title={t("ai.workshop.may")} subtitle={facts.may.join(" · ")} wrap />}
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
        {facts.warnings.map((warning) => (
          <Banner key={warning} kind="warning">
            {warning}
          </Banner>
        ))}
        {facts.problems.length > 0 && <Banner kind="error">{facts.problems.join(" ")}</Banner>}
        {facts.canApprove && (
          <>
            <p className="m-hint">{t("ai.workshop.approvalHint")}</p>
            <Button variant="primary" disabled={busy} onClick={() => void approve()} data-testid="ai-skill-approve">
              {t("ai.workshop.approve")}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          {facts.canApprove ? t("ai.workshop.notNow") : t("common.close")}
        </Button>
      </div>
    </div>
  );
}
