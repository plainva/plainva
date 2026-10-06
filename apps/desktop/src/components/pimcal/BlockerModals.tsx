import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, Modal, Radio } from "@plainva/ui";

/**
 * The two questions blockers bring with them (K3).
 *
 * A blocker is a mirror of an event in another calendar. Moving the event
 * moves its blockers without asking — that is what a mirror does. The two
 * moments where the answer is not obvious are asked once each:
 *
 *  - a BLOCKER is moved or changed: was that meant for the blocker alone (then
 *    it stops being one) or for the event behind it?
 *  - an EVENT with blockers is deleted: should the blockers go too?
 *
 * Both dialogs only collect the answer; the writes are the caller's.
 */

const hintStyle = { display: "block", fontSize: "var(--text-sm)", color: "var(--text-muted)" } as const;

function Choice({ label, hint }: { label: string; hint: string }): ReactNode {
  return (
    <span>
      {label}
      <span style={hintStyle}>{hint}</span>
    </span>
  );
}

interface BlockerChangeModalProps {
  /** A drag asks about moving, an edit in the form about changing. */
  kind: "move" | "edit";
  /** The calendar the blocker lies in. */
  blockerCalendar: string;
  sourceTitle: string;
  sourceCalendar: string;
  /** False for an invitation of somebody else: the event is not the user's to move. */
  canChangeSource: boolean;
  onPick: (choice: "blocker" | "source") => void;
  onCancel: () => void;
}

export function BlockerChangeModal({ kind, blockerCalendar, sourceTitle, sourceCalendar, canChangeSource, onPick, onCancel }: BlockerChangeModalProps) {
  const { t } = useTranslation();
  // Preselected: the answer that changes nothing the user did not touch.
  const [choice, setChoice] = useState<"blocker" | "source">("blocker");
  const move = kind === "move";
  return (
    <Modal
      title={t("pim.blockerAskTitle", { defaultValue: "Dieser Eintrag ist ein Blocker" })}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="primary" data-testid="blocker-ask-confirm" onClick={() => onPick(choice)}>
            {move ? t("pim.blockerAskMove", { defaultValue: "Verschieben" }) : t("common.save", { defaultValue: "Speichern" })}
          </Button>
        </>
      }
    >
      <div data-testid="blocker-ask" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          {t("pim.blockerAskBody", {
            defaultValue: "Er hält in „{{calendar}}“ die Zeit von „{{title}}“ frei (Kalender „{{sourceCalendar}}“).",
            calendar: blockerCalendar,
            title: sourceTitle,
            sourceCalendar,
          })}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Radio
            name="blocker-ask"
            data-testid="blocker-ask-only"
            checked={choice === "blocker"}
            onChange={() => setChoice("blocker")}
            label={
              <Choice
                label={move ? t("pim.blockerOnlyMove", { defaultValue: "Nur diesen Blocker verschieben" }) : t("pim.blockerOnlyEdit", { defaultValue: "Nur diesen Blocker ändern" })}
                hint={t("pim.blockerOnlyHint", { defaultValue: "Er wird ein eigener Eintrag; der Termin bleibt, wie er ist." })}
              />
            }
          />
          {canChangeSource ? (
            <Radio
              name="blocker-ask"
              data-testid="blocker-ask-source"
              checked={choice === "source"}
              onChange={() => setChoice("source")}
              label={
                <Choice
                  label={move ? t("pim.blockerSourceMove", { defaultValue: "Den Termin verschieben" }) : t("pim.blockerSourceEdit", { defaultValue: "Den Termin ändern" })}
                  hint={t("pim.blockerSourceHint", { defaultValue: "Der Termin und alle seine Blocker übernehmen die Änderung." })}
                />
              }
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

interface DeleteWithBlockersModalProps {
  eventTitle: string;
  blockerCount: number;
  /** The calendars the blockers lie in, already joined for display. */
  blockerCalendars: string;
  onConfirm: (alsoBlockers: boolean) => void;
  onCancel: () => void;
}

export function DeleteWithBlockersModal({ eventTitle, blockerCount, blockerCalendars, onConfirm, onCancel }: DeleteWithBlockersModalProps) {
  const { t } = useTranslation();
  // Ticked: a blocker without its event holds time free for nothing.
  const [alsoBlockers, setAlsoBlockers] = useState(true);
  return (
    <Modal
      title={t("pim.deleteEvent", { defaultValue: "Termin löschen" })}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="danger" data-testid="delete-blockers-confirm" onClick={() => onConfirm(alsoBlockers)}>
            {t("common.delete", { defaultValue: "Löschen" })}
          </Button>
        </>
      }
    >
      <div data-testid="delete-blockers" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          {t("pim.deleteEventMsg", { defaultValue: "„{{title}}“ wird im Kalender des Anbieters gelöscht.", title: eventTitle })}
        </p>
        <Checkbox checked={alsoBlockers} onChange={() => setAlsoBlockers((v) => !v)} data-testid="delete-blockers-also">
          <Choice
            label={t("pim.deleteAlsoBlockers", { defaultValue: "Auch die Blocker löschen ({{n}})", n: blockerCount })}
            hint={t("pim.deleteBlockersIn", { defaultValue: "in {{cals}}", cals: blockerCalendars })}
          />
        </Checkbox>
      </div>
    </Modal>
  );
}
