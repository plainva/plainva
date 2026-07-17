import { useTranslation } from "react-i18next";
import { Modal, Button } from "@plainva/ui";

/**
 * Scope chooser for actions on a recurring-event INSTANCE (stage 4):
 * "only this event" targets the occurrence (override/EXDATE), "all events"
 * targets the series master. For deletions this dialog IS the confirmation —
 * the message names the event and states that it deletes.
 */

interface SeriesScopeModalProps {
  action: "edit" | "delete";
  eventTitle: string;
  onPick: (scope: "this" | "all") => void;
  onCancel: () => void;
}

export function SeriesScopeModal({ action, eventTitle, onPick, onCancel }: SeriesScopeModalProps) {
  const { t } = useTranslation();
  return (
    <Modal title={t("pim.seriesTitle", { defaultValue: "Serientermin" })} onClose={onCancel} size="sm">
      <div data-testid="series-scope" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          {action === "delete"
            ? t("pim.seriesDeleteMsg", { defaultValue: "„{{title}}“ ist Teil einer Serie. Was möchtest Du löschen?", title: eventTitle })
            : t("pim.seriesEditMsg", { defaultValue: "„{{title}}“ ist Teil einer Serie. Was möchtest Du bearbeiten?", title: eventTitle })}
        </p>
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
