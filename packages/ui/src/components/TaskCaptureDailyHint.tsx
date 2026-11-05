import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";

/**
 * Where a captured task lands when the vault has no task database (plan
 * Rückmeldungen 2026-11-05, E1): a checkbox in today's daily note. The line
 * says so and offers the database, after which the capture makes a task note
 * instead. Both shells show it with their capture, the phone in the sheet,
 * the desktop under the bar.
 */
export function TaskCaptureDailyHint({ onCreateDatabase }: { onCreateDatabase?: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="pv-capture-target" data-testid="task-capture-daily">
      {t("tasks.captureDailyHint")}
      {onCreateDatabase && (
        <>
          {" "}
          <Button variant="ghost" size="sm" onClick={onCreateDatabase} data-testid="task-capture-create-db">
            {t("tasks.captureCreateDatabase")}
          </Button>
        </>
      )}
    </p>
  );
}
