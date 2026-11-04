import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { GroupCard, ICON, Row, RowList, SectionLabel, upkeepRowActions, upkeepTitle, type UpkeepRow } from "@plainva/ui";
import { RowActionSheet } from "./RowActionSheet";

/**
 * "Tidy up" on the phone (plan KI-Harness P6-3, mockup chapter 22, step 7):
 * what this device noticed by itself about the skills or about the memory —
 * the desktop's card as a group of rows. A tap on a row opens what it can do:
 * its one step, and "don't show again" (`upkeepRowActions`, the list the
 * desktop's buttons are made of).
 *
 * `children`: rows of the view's own, in a card behind the hints and the
 * sentence that says no model was asked. The group is absent while it has
 * neither.
 */
export function MobileUpkeepGroup({ rows, onStep, onDismiss, children }: { rows: readonly UpkeepRow[]; onStep: (row: UpkeepRow) => void; onDismiss: (key: string) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<UpkeepRow | null>(null);
  if (rows.length === 0 && !children) return null;
  return (
    <>
      <SectionLabel>{upkeepTitle(t, rows.length)}</SectionLabel>
      {rows.length > 0 && (
        <>
          <GroupCard>
            <RowList>
              {rows.map((row) => (
                <Row key={row.key} title={row.label} subtitle={row.desc} wrap onClick={() => setSheet(row)} end={<ChevronRight size={ICON.ui} />} data-testid="ai-upkeep-row" />
              ))}
            </RowList>
          </GroupCard>
          <p className="m-hint">{t("ai.upkeep.note")}</p>
        </>
      )}
      {/* Behind the sentence that says no model was asked: what the view adds may well ask one, and says so itself. */}
      {children && (
        <GroupCard>
          <RowList>{children}</RowList>
        </GroupCard>
      )}
      {sheet && (
        <RowActionSheet
          title={sheet.label}
          // The sheet closes with the choice: what a step opens — a comparison, a form, a review — must not lie under it.
          actions={upkeepRowActions(t, { ...(sheet.step ? { step: () => onStep(sheet), stepLabel: sheet.step.label } : {}), dismiss: () => onDismiss(sheet.key) }).map((a) => ({
            icon: <a.icon size={ICON.head} />,
            label: a.label,
            testId: `ai-upkeep-action-${a.id}`,
            onClick: () => {
              setSheet(null);
              a.run();
            },
          }))}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
