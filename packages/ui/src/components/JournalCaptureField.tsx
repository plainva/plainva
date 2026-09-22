import { useId, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Square, SquareCheck } from "lucide-react";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { TextArea } from "./ui/Field";
import { ShortcutHints } from "./ui/ShortcutHints";
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
  /**
   * Where the entry goes, on its own line ABOVE the field — "Daily note
   * 2026-09-22 · will be created". It answers "where does this land?", which is
   * a different question from "which key does what?" and used to share a line
   * with it (finding 2026-09-22).
   */
  target?: ReactNode;
  /** Replaces the hint line under the field. `null`: no hint line. */
  hint?: ReactNode;
  /**
   * The named exit: hands what was typed to the task capture and closes. Drawn
   * as a `ghost` button, not as a switch — it leaves this surface, and a
   * control that leaves should not look like one that toggles.
   */
  onHandover?: () => void;
  /** Rendered beside the task chip: attach a photo, the phone's buttons. */
  extras?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  testId?: string;
}

export function JournalCaptureField({
  value, onChange, asTask, onAsTask, onSubmit, onCancel, enterSubmits = true, autoFocus, disabled, rows = 2, placeholder, time, target, hint, onHandover, extras, inputRef, testId = "journal-capture",
}: JournalCaptureFieldProps) {
  const { t, i18n } = useTranslation();
  const now = useMinuteClock();
  const hintId = useId();
  // An entry's own time is "as written" (`9:05`, `14:05:30`); shown and stamped is the minute.
  const [hours, minutes] = (time ?? now).split(":").map(Number);
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const shown = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
  // Where there is a physical keyboard the hint is a chain of unbreakable
  // key/word pairs; a soft keyboard has none of those keys and gets a sentence.
  const defaultHint = enterSubmits
    ? (
      <ShortcutHints
        hints={[
          { keys: ["Enter"], label: t("journal.hintSave") },
          { keys: ["Shift", "Enter"], label: t("journal.hintNewLine") },
          ...(onCancel ? [{ keys: ["Esc"], label: t("journal.hintDiscard") }] : []),
        ]}
      />
    )
    : t("journal.captureHintTouch");
  const hintLine = hint === undefined ? defaultHint : hint;

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
      {target && <p className="pv-capture-target" data-testid={`${testId}-target`}>{target}</p>}
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
        {/* The chip shows its state the way every other checkbox in the app
            does: empty box unchecked, ticked box checked. It carried the
            ticked box always, so it read as already chosen (finding 2026-09-22). */}
        <Chip icon={asTask ? <SquareCheck size={ICON.meta} /> : <Square size={ICON.meta} />} selected={asTask} onClick={() => onAsTask(!asTask)} testId={`${testId}-task`}>
          {t("journal.asTask")}
        </Chip>
        {extras}
        {onHandover && (
          <Button variant="ghost" size="sm" className="pv-capture-exit" onClick={onHandover} disabled={disabled} data-testid={`${testId}-handover`}>
            {t("journal.instead")}
            <ArrowRight size={ICON.meta} />
          </Button>
        )}
      </div>
      {hintLine && <p className="pv-capture-hint" id={hintId}>{hintLine}</p>}
    </div>
  );
}
