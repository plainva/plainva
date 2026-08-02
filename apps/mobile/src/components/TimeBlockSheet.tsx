import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, minutesToTime, Segmented, type TaskBlockValues, TextInput, timeToMinutes } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { mSelect } from "../services/mobileDialogs";

/**
 * "Block time" for a task on the phone (S24) — the mobile shape of the desktop
 * dialog, on the same shared draft builder.
 *
 * Deliberately small: the task already knows WHAT it is and WHEN it is due;
 * this only asks for the window. Collects values only — the provider write is
 * the caller's job, so a failure surfaces here and the sheet stays open with
 * what was typed.
 */

/** The lengths people actually block. "custom" reveals a minutes field. */
const PRESETS = [15, 30, 60, 120] as const;
type DurationChoice = "15" | "30" | "60" | "120" | "custom";

export function TimeBlockSheet({
  taskTitle,
  initialDayKey,
  initialStartTime,
  calendarOptions,
  initialCalendarKey,
  onClose,
  onSubmit,
}: {
  taskTitle: string;
  /** Day the block starts on (YYYY-MM-DD) — the task's due date, else today. */
  initialDayKey: string;
  /** Start as "HH:MM" (next half hour). */
  initialStartTime: string;
  /** Writable calendars; a single entry hides the picker. */
  calendarOptions: Array<{ value: string; label: string }>;
  initialCalendarKey: string;
  onClose: () => void;
  onSubmit: (values: TaskBlockValues, calendarKey: string) => Promise<void>;
}) {
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

  // "h"/"min" are unit abbreviations, identical for 1 and many in every app
  // language — a plural key would buy nothing and cost ten plural categories.
  const durationLabel = (minutes: number) =>
    minutes % 60 === 0 ? t("pim.blockHours", { n: minutes / 60 }) : t("pim.blockLengthMinutes", { n: minutes });

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    void onSubmit({ dayKey, startTime, durationMinutes }, calendarKey).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  const pickCalendar = () => {
    void (async () => {
      const picked = await mSelect({ title: t("pim.eventCalendar"), options: calendarOptions, value: calendarKey });
      if (picked !== null) setCalendarKey(picked);
    })();
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="m-sheet" data-testid="task-block-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("pim.blockTime")}</p>
        <p className="m-hint m-hint--inset">{taskTitle}</p>
        <p className="m-hint m-hint--inset">{t("pim.blockCreatesEvent")}</p>

        <label className="m-field">
          <span>{t("pim.eventDate")}</span>
          <TextInput data-testid="task-block-day" onChange={(e) => setDayKey(e.target.value)} type="date" value={dayKey} />
        </label>
        <label className="m-field">
          <span>{t("pim.eventFrom")}</span>
          <TextInput
            data-testid="task-block-start"
            onChange={(e) => setStartTime(e.target.value)}
            type="time"
            value={startTime}
          />
        </label>

        <p className="m-sectionlabel">{t("pim.blockDuration")}</p>
        <Segmented
          ariaLabel={t("pim.blockDuration")}
          options={[
            ...PRESETS.map((m) => ({ value: String(m), label: durationLabel(m) })),
            { value: "custom", label: t("pim.blockCustom"), testId: "task-block-custom" },
          ]}
          value={choice}
          onChange={(v) => setChoice(v as DurationChoice)}
        />
        {choice === "custom" && (
          <label className="m-field">
            <span>{t("pim.blockMinutesLabel")}</span>
            <TextInput
              inputMode="numeric"
              min={5}
              onChange={(e) => setCustomMinutes(e.target.value)}
              type="number"
              value={customMinutes}
            />
          </label>
        )}
        {endLabel && <p className="m-hint m-hint--inset">{t("pim.blockUntil", { time: endLabel })}</p>}

        {calendarOptions.length > 1 && (
          <button className="m-row" onClick={pickCalendar}>
            <span>{t("pim.eventCalendar")}</span>
            <span>{calendarOptions.find((o) => o.value === calendarKey)?.label ?? "—"}</span>
          </button>
        )}

        {error && (
          <Banner kind="error" rounded>
            {error}
          </Banner>
        )}

        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            data-testid="task-block-submit"
            disabled={!valid || busy}
            onClick={submit}
          >
            {t("pim.blockTime")}
          </Button>
        </div>
      </div>
    </div>
  );
}
