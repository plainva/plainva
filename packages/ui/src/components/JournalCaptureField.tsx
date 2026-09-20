import { useId, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { SquareCheck } from "lucide-react";
import { Chip } from "./ui/Chip";
import { TextArea } from "./ui/Field";
import { ICON } from "../lib/iconSizes";
import { useMinuteClock } from "../hooks/useMinuteClock";

/**
 * The capture field of the journal (plan Journal, J4), shared by both shells:
 * the desktop puts it into a small dialog, the phone into its capture sheet,
 * and both into the "journal" section of a day.
 *
 * It shows the time the entry WILL carry — Plainva stamps it, nobody types it —
 * and a chip that makes the entry a task (`- [ ] 14:05 …`). The text is plain
 * Markdown: tags, links and a second line are simply typed.
 *
 * Enter saves where there is a physical keyboard. A soft keyboard has no
 * Shift+Enter, so there Enter stays a line break and a button saves
 * (`enterSubmits={false}`).
 */
export interface JournalCaptureFieldProps {
  value: string;
  onChange: (value: string) => void;
  asTask: boolean;
  onAsTask: (next: boolean) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  /** Enter saves, Shift+Enter breaks the line (default). `false`: Enter breaks the line. */
  enterSubmits?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
  /** The time the field shows instead of "now" — an entry that is being edited keeps its own (`HH:mm`). */
  time?: string;
  /** Replaces the hint line — e.g. which daily note the entry goes to. `null`: no hint line. */
  hint?: ReactNode;
  /** Rendered beside the task chip: attach a photo, the phone's buttons. */
  extras?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  testId?: string;
}

export function JournalCaptureField({
  value, onChange, asTask, onAsTask, onSubmit, onCancel, enterSubmits = true, autoFocus, disabled, rows = 2, placeholder, time, hint, extras, inputRef, testId = "journal-capture",
}: JournalCaptureFieldProps) {
  const { t, i18n } = useTranslation();
  const now = useMinuteClock();
  const hintId = useId();
  // An entry's own time is "as written" (`9:05`, `14:05:30`); shown and stamped is the minute.
  const [hours, minutes] = (time ?? now).split(":").map(Number);
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const shown = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
  const hintLine = hint === undefined ? t(enterSubmits ? "journal.captureHint" : "journal.captureHintTouch") : hint;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && enterSubmits && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="pv-journal-capture" data-testid={testId}>
      <div className="pv-journal-capture-row">
        <time className="pv-journal-time" dateTime={clock} data-testid={`${testId}-time`}>{shown}</time>
        <TextArea
          ref={inputRef}
          className="pv-journal-capture-input"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? t("journal.capturePlaceholder")}
          aria-label={t("journal.captureLabel")}
          aria-describedby={hintLine ? hintId : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          data-testid={`${testId}-input`}
          enterKeyHint={enterSubmits ? "done" : "enter"}
          autoComplete="off"
          spellCheck
        />
      </div>
      <div className="pv-capture-quick">
        <Chip icon={<SquareCheck size={ICON.meta} />} selected={asTask} onClick={() => onAsTask(!asTask)} testId={`${testId}-task`}>
          {t("journal.asTask")}
        </Chip>
        {extras}
      </div>
      {hintLine && <p className="pv-capture-hint" id={hintId}>{hintLine}</p>}
    </div>
  );
}
