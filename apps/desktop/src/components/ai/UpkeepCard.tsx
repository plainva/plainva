import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button, ICON, IconButton, SettingCard, SettingCardNote, SettingRow, upkeepRowActions, upkeepTitle, type UpkeepRow } from "@plainva/ui";

/**
 * "Tidy up" in the AI tab (plan KI-Harness P6-3, mockup chapter 22, step 7):
 * what this device noticed by itself about the skills or about the memory,
 * each as a row — the matter as a sentence, why it counts, and one step.
 * Nothing in this card came from a model, and none of its buttons changes a
 * file by itself: a step is what the user could do by hand in the list below.
 *
 * `children`: a row of the view's own behind the hints and behind the
 * sentence that says no model was asked (the memory's offer to have a skill
 * look through it — which does ask one). The card is absent while it has
 * neither.
 */
export function UpkeepCard({
  rows,
  onStep,
  onDismiss,
  children,
  testId,
}: {
  rows: readonly UpkeepRow[];
  onStep: (row: UpkeepRow) => void;
  onDismiss: (key: string) => void;
  children?: ReactNode;
  testId: string;
}) {
  const { t } = useTranslation();
  if (rows.length === 0 && !children) return null;
  return (
    <div data-testid={testId}>
      <SettingCard label={upkeepTitle(t, rows.length)}>
        {rows.map((row) => {
          // What a row can do is the shared list's (`upkeepRowActions`): the phone's sheet shows the same two.
          const actions = upkeepRowActions(t, { ...(row.step ? { step: () => onStep(row), stepLabel: row.step.label } : {}), dismiss: () => onDismiss(row.key) });
          return (
            <SettingRow key={row.key} label={row.label} desc={row.desc}>
              <div className="pv-ai-rowactions" data-testid="ai-upkeep-row" data-kind={row.kind}>
                {actions.map((action) =>
                  action.id === "dismiss" ? (
                    <IconButton key={action.id} label={action.label} size="sm" onClick={action.run} data-testid="ai-upkeep-dismiss">
                      <X size={ICON.ui} />
                    </IconButton>
                  ) : (
                    <Button key={action.id} size="sm" variant="ghost" onClick={action.run} data-testid="ai-upkeep-step">
                      {action.label}
                    </Button>
                  ),
                )}
              </div>
            </SettingRow>
          );
        })}
        {/* The sentence belongs to the hints above it; what the view adds below may well ask a model, and says so itself. */}
        {rows.length > 0 && <SettingCardNote>{t("ai.upkeep.note")}</SettingCardNote>}
        {children}
      </SettingCard>
    </div>
  );
}
