import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { Button, ICON, Modal, Segmented } from "@plainva/ui";
import { nextDueDate, type RepeatFreq, type RepeatFrom, type RepeatRule } from "@plainva/ui";
import { localIsoKey } from "@plainva/ui";

/**
 * Repetition of a task (issue #34, wave 3). Small on purpose: a task repeats in
 * a rhythm, and the only genuinely interesting choice is what the rhythm counts
 * FROM — the due date (a fixed cadence like "every Monday") or the day it was
 * ticked ("every three days after I do it"). Everything a calendar series needs
 * beyond that (weekday sets, end dates, exceptions) belongs to events, which
 * have it.
 *
 * The dialog only collects values; writing the rule is the caller's job.
 */

const FREQS: RepeatFreq[] = ["daily", "weekly", "monthly", "yearly"];

interface RepeatTaskModalProps {
  taskTitle: string;
  /** Current rule; null = the task does not repeat yet. */
  initial: RepeatRule | null;
  /** The task's due date (YYYY-MM-DD), for the preview. */
  currentDue?: string | null;
  onCancel: () => void;
  onSubmit: (rule: RepeatRule | null) => Promise<void>;
}

export function RepeatTaskModal({ taskTitle, initial, currentDue, onCancel, onSubmit }: RepeatTaskModalProps) {
  const { t } = useTranslation();
  const [freq, setFreq] = useState<RepeatFreq>(initial?.freq ?? "weekly");
  const [interval, setIntervalValue] = useState(String(initial?.interval ?? 1));
  const [from, setFrom] = useState<RepeatFrom>(initial?.from ?? "due");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.max(1, Math.floor(Number(interval) || 0));

  /**
   * The preview, and the reason this dialog is worth its space: "every 2 ·
   * weekly · from the due date" is a rule, "Mon 17 Aug" is an answer. It also
   * shows the overdue case without explaining it — the date it names is the
   * next one in the FUTURE, not the arithmetically next one in the past.
   */
  const today = localIsoKey(new Date());
  const preview = nextDueDate({ freq, interval: n, from }, currentDue ?? null, today);
  const previewLabel = preview
    ? new Date(`${preview}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : null;

  const submit = async (rule: RepeatRule | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const freqLabel: Record<RepeatFreq, string> = {
    daily: t("tasks.repeatDaily", { defaultValue: "Täglich" }),
    weekly: t("tasks.repeatWeekly", { defaultValue: "Wöchentlich" }),
    monthly: t("tasks.repeatMonthly", { defaultValue: "Monatlich" }),
    yearly: t("tasks.repeatYearly", { defaultValue: "Jährlich" }),
  };

  return (
    <Modal
      title={t("tasks.repeat", { defaultValue: "Wiederholung" })}
      onClose={onCancel}
      size="sm"
      testId="task-repeat-modal"
      footer={
        <>
          {initial && (
            <Button variant="ghost" size="sm" onClick={() => void submit(null)} disabled={busy} data-testid="task-repeat-off">
              {t("tasks.repeatNone", { defaultValue: "Nicht wiederholen" })}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submit({ freq, interval: n, from })}
            disabled={busy}
            data-testid="task-repeat-submit"
          >
            {t("common.save", { defaultValue: "Speichern" })}
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
              {t("tasks.repeatHint", {
                defaultValue: "Beim Abhaken legt Plainva die nächste Aufgabe mit der neuen Fälligkeit an.",
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="pv-setgroup">
        <div className="pv-setgroup-label">{t("tasks.repeatRhythm", { defaultValue: "Rhythmus" })}</div>
        <div className="pv-setcard">
          <div className="pv-setrow pv-setrow--wide">
            <span className="pv-setrow-label">{t("pim.repeat", { defaultValue: "Wiederholung" })}</span>
            <Segmented<RepeatFreq>
              value={freq}
              onChange={setFreq}
              size="sm"
              ariaLabel={t("pim.repeat", { defaultValue: "Wiederholung" })}
              options={FREQS.map((f) => ({ value: f, label: freqLabel[f], testId: `task-repeat-${f}` }))}
            />
          </div>
          <div className="pv-setrow">
            <div className="pv-setrow-main">
              <div className="pv-setrow-label">{t("tasks.repeatInterval", { defaultValue: "Alle" })}</div>
            </div>
            <div className="pv-setrow-ctrl">
              <input
                type="number"
                min={1}
                max={999}
                className="pv-field"
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
                data-testid="task-repeat-interval"
                style={{ maxWidth: 100 }}
              />
            </div>
          </div>
          <div className="pv-setrow pv-setrow--wide">
            <span className="pv-setrow-label">{t("tasks.repeatFrom", { defaultValue: "Gezählt ab" })}</span>
            <Segmented<RepeatFrom>
              value={from}
              onChange={setFrom}
              size="sm"
              ariaLabel={t("tasks.repeatFrom", { defaultValue: "Gezählt ab" })}
              options={[
                { value: "due", label: t("tasks.repeatFromDue", { defaultValue: "Fälligkeit" }), testId: "task-repeat-from-due" },
                {
                  value: "completion",
                  label: t("tasks.repeatFromCompletion", { defaultValue: "Erledigung" }),
                  testId: "task-repeat-from-completion",
                },
              ]}
            />
            <div className="pv-setrow-desc">
              {from === "due"
                ? t("tasks.repeatFromDueHint", {
                    defaultValue: "Fester Takt. Eine überfällige Aufgabe springt auf die nächste Fälligkeit in der Zukunft.",
                  })
                : t("tasks.repeatFromCompletionHint", { defaultValue: "Der Takt beginnt an dem Tag, an dem Du abhakst." })}
            </div>
          </div>
        </div>
      </div>

      {previewLabel && (
        <div
          data-testid="task-repeat-preview"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-md)",
            background: "var(--success-bg)",
            color: "var(--success-text)",
            fontSize: "var(--text-sm)",
          }}
        >
          <CalendarDays size={ICON.meta} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {t("tasks.repeatPreview", { defaultValue: "Nächste Fälligkeit: {{date}}", date: previewLabel })}
            {from === "completion" && (
              <span style={{ display: "block", opacity: 0.85 }}>
                {t("tasks.repeatPreviewFromToday", { defaultValue: "Gerechnet ab heute, weil Du beim Abhaken zählst." })}
              </span>
            )}
          </span>
        </div>
      )}

      {initial && (
        <div className="pv-setgroup">
          <div className="pv-setgroup-label">{t("tasks.repeatInNote", { defaultValue: "Steht in der Notiz" })}</div>
          {/* Shown only for an EXISTING rule: while creating one it would be a
              promise, on an existing one it is the truth on disk — copyable,
              visible in Obsidian, checkable with any text editor. */}
          <pre
            data-testid="task-repeat-frontmatter"
            style={{
              margin: 0,
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md)",
              background: "var(--code-bg)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "var(--text-xs)",
              overflowX: "auto",
            }}
          >{`plainva:\n  repeat:\n    freq: ${freq}\n    interval: ${n}\n    from: ${from}`}</pre>
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
