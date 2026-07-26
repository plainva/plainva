import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, Segmented } from "@plainva/ui";
import { Select } from "../Select";
import { minutesToTime, timeToMinutes, type TaskBlockValues } from "../../services/pim/calendarModel";

/**
 * "Block time" dialog for a task (issue #34, wave 3). Deliberately small: a
 * task already knows WHAT and WHEN it is due — this only asks for the window.
 * Layout follows the quiet-cards look of the event dialog so both calendar
 * dialogs read as one family.
 *
 * The dialog only collects values; the provider write is the caller's job, so a
 * failure surfaces here as an inline error and the dialog stays open.
 */

/** Duration presets. "custom" reveals a minutes field; the values are the ones
 * people actually block (a quarter hour, a half hour, an hour, an afternoon). */
const PRESETS = [15, 30, 60, 120] as const;
type DurationChoice = "15" | "30" | "60" | "120" | "custom";

interface TimeBlockModalProps {
  taskTitle: string;
  /** Day the block starts on (YYYY-MM-DD) — the task's due date, else today. */
  initialDayKey: string;
  /** Start as "HH:MM" (next half hour). */
  initialStartTime: string;
  /** Writable calendars; a single entry hides the picker. */
  calendarOptions: Array<{ value: string; label: string }>;
  initialCalendarKey: string;
  onCancel: () => void;
  onSubmit: (values: TaskBlockValues, calendarKey: string) => Promise<void>;
}

export function TimeBlockModal(props: TimeBlockModalProps) {
  const { taskTitle, initialDayKey, initialStartTime, calendarOptions, initialCalendarKey, onCancel, onSubmit } = props;
  const { t } = useTranslation();
  const [dayKey, setDayKey] = useState(initialDayKey);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [choice, setChoice] = useState<DurationChoice>("60");
  const [customMinutes, setCustomMinutes] = useState("90");
  const [calendarKey, setCalendarKey] = useState(initialCalendarKey || calendarOptions[0]?.value || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationMinutes = choice === "custom" ? Math.max(5, Number(customMinutes) || 0) : Number(choice);
  const startMin = timeToMinutes(startTime);
  const endLabel = startMin === null ? "" : minutesToTime(Math.min(startMin + durationMinutes, 24 * 60 - 1));
  const valid = startMin !== null && durationMinutes >= 5 && !!dayKey && !!calendarKey;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ dayKey, startTime, durationMinutes }, calendarKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // "h"/"min" are unit abbreviations, identical for 1 and many in every app
  // language — a plural key would buy nothing and cost ten plural categories.
  const durationLabel = (minutes: number) =>
    minutes % 60 === 0
      ? t("pim.blockHours", { defaultValue: "{{n}} h", n: minutes / 60 })
      : t("pim.blockLengthMinutes", { defaultValue: "{{n}} min", n: minutes });

  return (
    <Modal
      title={t("pim.blockTime", { defaultValue: "Zeit blocken" })}
      onClose={onCancel}
      size="sm"
      testId="task-block-modal"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!valid || busy} data-testid="task-block-submit">
            {t("pim.blockTime", { defaultValue: "Zeit blocken" })}
          </Button>
        </>
      }
    >
      <div className="pv-setgroup">
        <div className="pv-setgroup-label">{t("tasks.title", { defaultValue: "Aufgaben" })}</div>
        <div className="pv-setcard">
          <div className="pv-setrow pv-setrow--wide">
            <span className="pv-setrow-label">{taskTitle}</span>
            <div className="pv-setrow-desc">
              {t("pim.blockCreatesEvent", { defaultValue: "Legt einen Termin mit diesem Titel an und verknüpft ihn mit der Notiz." })}
            </div>
          </div>
        </div>
      </div>

      <div className="pv-setgroup">
        <div className="pv-setgroup-label">{t("pim.groupTime", { defaultValue: "Zeit" })}</div>
        <div className="pv-setcard">
          <div className="pv-setrow pv-setrow--wide">
            <span className="pv-setrow-label">{t("pim.eventWhen", { defaultValue: "Datum & Uhrzeit" })}</span>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: "var(--text-sm)" }}>
                {t("pim.eventDate", { defaultValue: "Datum" })}
                <input
                  type="date"
                  className="pv-field"
                  value={dayKey}
                  onChange={(e) => setDayKey(e.target.value)}
                  data-testid="task-block-day"
                  style={{ display: "block", marginTop: 2 }}
                />
              </label>
              <label style={{ fontSize: "var(--text-sm)" }}>
                {t("pim.eventFrom", { defaultValue: "Von" })}
                <input
                  type="time"
                  className="pv-field"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  data-testid="task-block-start"
                  style={{ display: "block", marginTop: 2 }}
                />
              </label>
            </div>
          </div>
          <div className="pv-setrow pv-setrow--wide">
            <span className="pv-setrow-label">{t("pim.blockDuration", { defaultValue: "Dauer" })}</span>
            <Segmented<DurationChoice>
              value={choice}
              onChange={setChoice}
              size="sm"
              ariaLabel={t("pim.blockDuration", { defaultValue: "Dauer" })}
              options={[
                ...PRESETS.map((m) => ({ value: String(m) as DurationChoice, label: durationLabel(m), testId: `task-block-${m}` })),
                { value: "custom" as DurationChoice, label: t("pim.blockCustom", { defaultValue: "Eigene" }), testId: "task-block-custom" },
              ]}
            />
            {choice === "custom" && (
              <label style={{ fontSize: "var(--text-sm)", marginTop: "var(--space-2)", display: "block" }}>
                {t("pim.blockMinutesLabel", { defaultValue: "Minuten" })}
                <input
                  type="number"
                  min={5}
                  step={5}
                  className="pv-field"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  data-testid="task-block-minutes"
                  style={{ display: "block", marginTop: 2, maxWidth: 120 }}
                />
              </label>
            )}
            {endLabel && (
              <div className="pv-setrow-desc" data-testid="task-block-until">
                {t("pim.blockUntil", { defaultValue: "Bis {{time}}", time: endLabel })}
              </div>
            )}
          </div>
        </div>
      </div>

      {calendarOptions.length > 1 && (
        <div className="pv-setgroup">
          <div className="pv-setgroup-label">{t("pim.eventCalendar", { defaultValue: "Kalender" })}</div>
          <div className="pv-setcard">
            <div className="pv-setrow">
              <div className="pv-setrow-main">
                <div className="pv-setrow-label">{t("pim.eventCalendar", { defaultValue: "Kalender" })}</div>
              </div>
              <div className="pv-setrow-ctrl" style={{ flexBasis: 260 }}>
                <Select
                  value={calendarKey}
                  onChange={setCalendarKey}
                  ariaLabel={t("pim.eventCalendar", { defaultValue: "Kalender" })}
                  data-testid="task-block-calendar"
                  options={calendarOptions}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: "var(--error-text)", fontSize: "var(--text-sm)" }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
