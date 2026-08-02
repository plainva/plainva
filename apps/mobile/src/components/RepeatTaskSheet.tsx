import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { Banner, Button, localIsoKey, nextDueDate, type RepeatFreq, type RepeatFrom, type RepeatRule, Segmented, TextInput } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Repetition of a task on the phone (S24) — the mobile shape of the desktop's
 * repeat dialog, on the same shared rule and the same `nextDueDate` preview.
 *
 * Small on purpose: a task repeats in a rhythm, and the only genuinely
 * interesting choice is what that rhythm counts FROM — the due date (a fixed
 * cadence like "every Monday") or the day it was ticked ("every three days
 * after I do it"). The preview is what makes the sheet worth its space:
 * "every 2 · weekly · from the due date" is a rule, a date is an answer — and
 * for an overdue task it silently shows the next date in the FUTURE.
 *
 * Collects values only; writing the rule is the caller's job.
 */

const FREQS: RepeatFreq[] = ["daily", "weekly", "monthly", "yearly"];

export function RepeatTaskSheet({
  taskTitle,
  initial,
  currentDue,
  onClose,
  onSubmit,
}: {
  taskTitle: string;
  /** Current rule; null = the task does not repeat yet. */
  initial: RepeatRule | null;
  /** The task's due date (YYYY-MM-DD), for the preview. */
  currentDue?: string | null;
  onClose: () => void;
  onSubmit: (rule: RepeatRule | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [freq, setFreq] = useState<RepeatFreq>(initial?.freq ?? "weekly");
  const [interval, setIntervalValue] = useState(String(initial?.interval ?? 1));
  const [from, setFrom] = useState<RepeatFrom>(initial?.from ?? "due");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.max(1, Math.floor(Number(interval) || 0));
  const preview = nextDueDate({ freq, interval: n, from }, currentDue ?? null, localIsoKey(new Date()));
  const previewLabel = preview
    ? new Date(`${preview}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const freqLabel: Record<RepeatFreq, string> = {
    daily: t("tasks.repeatDaily"),
    weekly: t("tasks.repeatWeekly"),
    monthly: t("tasks.repeatMonthly"),
    yearly: t("tasks.repeatYearly"),
  };

  const submit = (rule: RepeatRule | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void onSubmit(rule).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="m-sheet" data-testid="task-repeat-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("tasks.repeat")}</p>
        <p className="m-hint m-hint--inset">{taskTitle}</p>
        <p className="m-hint m-hint--inset">{t("tasks.repeatHint")}</p>

        <p className="m-sectionlabel">{t("tasks.repeatRhythm")}</p>
        <Segmented
          ariaLabel={t("tasks.repeatRhythm")}
          options={FREQS.map((f) => ({ value: f, label: freqLabel[f], testId: `task-repeat-${f}` }))}
          value={freq}
          onChange={setFreq}
        />

        <label className="m-field">
          <span>{t("tasks.repeatInterval")}</span>
          <TextInput
            data-testid="task-repeat-interval"
            inputMode="numeric"
            max={999}
            min={1}
            onChange={(e) => setIntervalValue(e.target.value)}
            type="number"
            value={interval}
          />
        </label>

        <p className="m-sectionlabel">{t("tasks.repeatFrom")}</p>
        <Segmented
          ariaLabel={t("tasks.repeatFrom")}
          options={[
            { value: "due", label: t("tasks.repeatFromDue"), testId: "task-repeat-from-due" },
            { value: "completion", label: t("tasks.repeatFromCompletion"), testId: "task-repeat-from-completion" },
          ]}
          value={from}
          onChange={(v) => setFrom(v as "due" | "completion")}
        />
        <p className="m-hint m-hint--inset">
          {from === "due" ? t("tasks.repeatFromDueHint") : t("tasks.repeatFromCompletionHint")}
        </p>

        {previewLabel && (
          <p className="m-hint m-hint--inset" data-testid="task-repeat-preview">
            <CalendarDays size={16} /> {t("tasks.repeatPreview", { date: previewLabel })}
            {from === "completion" ? ` ${t("tasks.repeatPreviewFromToday")}` : ""}
          </p>
        )}

        {error && (
          <Banner kind="error" rounded>
            {error}
          </Banner>
        )}

        <div className="m-btnrow">
          {initial && (
            <Button
              variant="ghost"
              data-testid="task-repeat-off"
              disabled={busy}
              onClick={() => submit(null)}
            >
              {t("tasks.repeatNone")}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            data-testid="task-repeat-submit"
            disabled={busy}
            onClick={() => submit({ freq, interval: n, from })}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
