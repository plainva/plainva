import { Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Button, ICON, LineCompare, Modal, skillCompareFacts, toast, useAiSession, useAiState } from "@plainva/ui";

/**
 * Two skills that say almost the same, side by side (plan KI-Harness P6-3,
 * mockup chapter 22, step 7): what each is for, what each may do, and their
 * instructions line against line. The hint that leads here is a question —
 * the dialog answers nothing by itself; switching one of the two off is the
 * same switch its row has, and it stays in the vault.
 */
export function SkillCompareModal({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const entries = state?.skills.entries;
  const find = (id: string) => entries?.find((candidate) => candidate.source.id === id) ?? null;
  const facts = skillCompareFacts(t, find(a), find(b), i18n.language);
  // Once the two are no longer both in force there is nothing left to choose between.
  const gone = facts === null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!session || !facts) return null;
  const switchOff = (id: string, name: string) => {
    void session.switchInstruction(id, false).then(() => toast.success(t("ai.upkeep.switchedOff", { name })));
  };
  return (
    <Modal
      title={facts.title}
      icon={<Scale size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-skill-compare"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <p className="pv-modal-hint">{t("ai.upkeep.compare.lead")}</p>
      {/* One list for every row: the labels share a column, so the values share an edge. */}
      <dl className="pv-skill-facts">
        {facts.sides.map((side) => (
          <Fragment key={side.id}>
            <dt>{side.title}</dt>
            <dd data-testid="ai-skill-compare-side">
              <span>{side.description}</span>
              {side.may.map((line) => (
                <span key={line}>{line}</span>
              ))}
              {/* A button with an edge of its own: that edge stands on the column the lines above share. */}
              <span>
                <Button size="sm" variant="secondary" onClick={() => switchOff(side.id, side.title)} data-testid="ai-skill-compare-off">
                  {t("ai.upkeep.compare.switchOff", { name: side.title })}
                </Button>
              </span>
            </dd>
          </Fragment>
        ))}
        <dt>{t("ai.upkeep.compare.instructions")}</dt>
        <dd>{facts.same ? <span data-testid="ai-skill-compare-same">{t("ai.upkeep.compare.same")}</span> : <LineCompare lines={facts.lines} fallback={facts.fallback} testId="ai-skill-compare-lines" />}</dd>
      </dl>
      <p className="pv-modal-hint">{t("ai.upkeep.compare.hint")}</p>
    </Modal>
  );
}
