import { useTranslation } from "react-i18next";
import { Modal, Button, eventChangeLabel, type EventChange } from "@plainva/ui";

/**
 * Scope chooser for actions on a recurring-event INSTANCE (stage 4):
 * "only this event" targets the occurrence (override/EXDATE), "all events"
 * targets the series master. For deletions this dialog IS the confirmation —
 * the message names the event and states that it deletes.
 *
 * Since S3 the SAVE case names the change ("Uhrzeit: 09:00 → 09:15"). The
 * question moved from opening the form to saving it, and at that moment there
 * is something concrete to decide about — a scope question that cannot say what
 * it applies to is a question the user cannot answer well.
 */

interface SeriesScopeModalProps {
  action: "edit" | "delete" | "save";
  eventTitle: string;
  /** Save case: what the user changed, so the dialog can name it. */
  changes?: readonly EventChange[];
  onPick: (scope: "this" | "all") => void;
  onCancel: () => void;
}

export function SeriesScopeModal({ action, eventTitle, changes, onPick, onCancel }: SeriesScopeModalProps) {
  const { t } = useTranslation();
  return (
    <Modal title={t("pim.seriesTitle", { defaultValue: "Serientermin" })} onClose={onCancel} size="sm">
      <div data-testid="series-scope" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          {action === "delete"
            ? t("pim.seriesDeleteMsg", { defaultValue: "„{{title}}“ ist Teil einer Serie. Was möchtest Du löschen?", title: eventTitle })
            : action === "save"
              ? t("pim.seriesSaveMsg", {
                  defaultValue: "„{{title}}“ gehört zu einer Serie. Worauf soll die Änderung wirken?",
                  title: eventTitle,
                })
              : t("pim.seriesEditMsg", { defaultValue: "„{{title}}“ ist Teil einer Serie. Was möchtest Du bearbeiten?", title: eventTitle })}
        </p>
        {action === "save" && changes && changes.length > 0 ? (
          <ul
            data-testid="series-scope-changes"
            style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
          >
            {changes.map((c) => (
              <li key={c.field}>{eventChangeLabel(c, t)}</li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="secondary" data-testid="series-scope-this" onClick={() => onPick("this")}>
            {t("pim.seriesThis", { defaultValue: "Nur diesen Termin" })}
          </Button>
          <Button
            variant={action === "delete" ? "danger" : "primary"}
            data-testid="series-scope-all"
            onClick={() => onPick("all")}
          >
            {t("pim.seriesAll", { defaultValue: "Alle Termine" })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
