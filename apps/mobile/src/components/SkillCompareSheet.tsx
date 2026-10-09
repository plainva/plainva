import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Button, GroupCard, LineCompare, Row, RowList, skillCompareFacts, toast } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * Two skills that say almost the same, on the phone (plan KI-Harness P6-3):
 * the desktop's comparison as a sheet — what each is for and may do, their
 * instructions line against line, and the switch that takes one of them out
 * of the catalog on this device. The facts are shared (`skillCompareFacts`).
 */
export function SkillCompareSheet({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const find = (id: string) => state.skills.entries.find((candidate) => candidate.source.id === id) ?? null;
  const facts = skillCompareFacts(t, find(a), find(b), i18n.language);
  // Once the two are no longer both in force there is nothing left to choose between.
  const gone = facts === null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!facts) return null;
  const switchOff = (id: string, name: string) => {
    void session.switchInstruction(id, false).then(() => toast.success(t("ai.upkeep.switchedOff", { name })));
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-compare">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{facts.title}</p>
        <p className="m-hint">{t("ai.upkeep.compare.lead")}</p>
        <GroupCard>
          <RowList>
            {facts.sides.flatMap((side) => [
              // What it is for is a sentence of its own; what it may do, the row the approval has too.
              <Row key={side.id} title={side.title} subtitle={side.description} wrap data-testid="ai-skill-compare-side" />,
              <Row key={`${side.id}:may`} title={t("ai.workshop.may")} subtitle={side.may.join(" · ")} wrap />,
            ])}
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.upkeep.compare.instructions")}</p>
        {facts.same ? (
          <p className="m-hint" data-testid="ai-skill-compare-same">
            {t("ai.upkeep.compare.same")}
          </p>
        ) : (
          <LineCompare lines={facts.lines} fallback={facts.fallback} testId="ai-skill-compare-lines" />
        )}
        <p className="m-hint">{t("ai.upkeep.compare.hint")}</p>
        {facts.sides.map((side) => (
          <Button key={side.id} variant="secondary" onClick={() => switchOff(side.id, side.title)} data-testid="ai-skill-compare-off">
            {t("ai.upkeep.compare.switchOff", { name: side.title })}
          </Button>
        ))}
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
