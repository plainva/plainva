import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Clock, Flag, Hash, Repeat } from "lucide-react";
import { Chip } from "./ui/Chip";
import { TextInput } from "./ui/Field";
import { ICON } from "../lib/iconSizes";
import { captureVocabularyFrom, parseTaskCapture, type CaptureBrick, type CaptureResult, type CaptureVocabulary } from "../lib/taskCapture";
import { describeRule } from "../lib/taskRecurrence";

/**
 * The capture field of the tasks view (plan Aufgaben-Oberfläche, B2), shared by
 * both shells: the desktop puts it above the planner, the phone into its sheet.
 *
 * The TEXT is the model. Everything recognised is drawn twice — marked inside
 * the field and as a brick below it — and nothing is applied that was not shown
 * first. Switching a brick off does not edit the text: the words stay where the
 * person typed them and simply count as title again.
 *
 * The marks inside the field are a mirror layer behind a transparent input
 * (`pv-capture-mirror` and the input share one box, font and inset, so a mark
 * sits exactly under its word, and the mirror follows the input's scrolling).
 * The mirror is `aria-hidden`; a screen reader gets the bricks, which say the
 * same thing in words.
 */

export function useCaptureVocabulary(): CaptureVocabulary {
  const { t, i18n } = useTranslation();
  return useMemo(
    () =>
      captureVocabularyFrom(
        {
          today: t("tasks.captureToday"), tomorrow: t("tasks.captureTomorrow"), dayAfterTomorrow: t("tasks.captureDayAfterTomorrow"),
          nextWeek: t("tasks.captureNextWeek"), inDays: t("tasks.captureInDays"), inWeeks: t("tasks.captureInWeeks"),
          daily: t("tasks.captureDaily"), weekly: t("tasks.captureWeekly"), monthly: t("tasks.captureMonthly"), yearly: t("tasks.captureYearly"),
          every: t("tasks.captureEvery"), everyNDays: t("tasks.captureEveryNDays"), everyNWeeks: t("tasks.captureEveryNWeeks"),
          oclock: t("tasks.captureOclock"), at: t("tasks.captureAt"),
        },
        i18n.language,
        t("tasks.captureWeekdays"),
      ),
    [t, i18n.language],
  );
}

export interface TaskCaptureApi {
  result: CaptureResult;
  vocab: CaptureVocabulary;
  submit: () => void;
}

export interface TaskCaptureFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Today's day key (`YYYY-MM-DD`) — passed in, so a test and a widget agree with the view. */
  todayKey: string;
  onSubmit: (result: CaptureResult) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Rendered under the bricks: the phone's quick buttons and its "Add" button. */
  extras?: (api: TaskCaptureApi) => ReactNode;
}

const BRICK_ICON = { date: CalendarDays, time: Clock, priority: Flag, tag: Hash, repeat: Repeat } as const;

export function TaskCaptureField({ value, onChange, todayKey, onSubmit, onCancel, autoFocus, extras }: TaskCaptureFieldProps) {
  const { t, i18n } = useTranslation();
  const vocab = useCaptureVocabulary();
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(() => new Set());
  const [needsTitle, setNeedsTitle] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const result = useMemo(() => parseTaskCapture(value, vocab, todayKey, disabled), [value, vocab, todayKey, disabled]);

  const label = (brick: CaptureBrick): string => {
    if (brick.kind === "date" && result.due) {
      const [y, m, d] = result.due.split("-").map(Number);
      return new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(y, m - 1, d));
    }
    if (brick.kind === "time" && result.minutes !== null) {
      return new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, Math.floor(result.minutes / 60), result.minutes % 60));
    }
    if (brick.kind === "priority") {
      return `${t("tasks.priority")}: ${t(result.priority === 1 ? "tasks.priorityHigh" : result.priority === 2 ? "tasks.priorityMedium" : "tasks.priorityLow")}`;
    }
    if (brick.kind === "repeat" && result.repeat) return describeRule(result.repeat, (key, o) => t(key, o));
    return brick.text;
  };

  const toggle = (brick: CaptureBrick) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(brick.id)) next.delete(brick.id);
      else next.add(brick.id);
      return next;
    });
  };

  const submit = () => {
    if (!result.title) {
      setNeedsTitle(true);
      return;
    }
    setNeedsTitle(false);
    setDisabled(new Set());
    onSubmit(result);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  };

  // The mirror: the same text, with the active bricks marked.
  const mirror: ReactNode[] = [];
  let at = 0;
  for (const brick of result.bricks) {
    if (!brick.active || brick.from < at) continue;
    if (brick.from > at) mirror.push(value.slice(at, brick.from));
    mirror.push(<mark key={`${brick.id}@${brick.from}`}>{value.slice(brick.from, brick.to)}</mark>);
    at = brick.to;
  }
  if (at < value.length) mirror.push(value.slice(at));

  return (
    <div className="pv-capture" data-testid="task-capture">
      <div className="pv-capture-box">
        <div className="pv-capture-mirror" aria-hidden="true" ref={mirrorRef}>{mirror}</div>
        <TextInput
          className="pv-capture-input"
          value={value}
          // A brick id is its text; when the text changes the old ids simply stop matching.
          onChange={(e) => { setNeedsTitle(false); onChange(e.target.value); }}
          onKeyDown={onKeyDown}
          onScroll={(e) => { if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
          placeholder={t("tasks.capturePlaceholder")}
          aria-label={t("tasks.newTask")}
          aria-describedby={hintId}
          autoFocus={autoFocus}
          data-testid="task-capture-input"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck
        />
      </div>
      {result.bricks.length > 0 && (
        <div className="pv-capture-bricks" data-testid="task-capture-bricks">
          {result.bricks.map((brick) => {
            const Icon = BRICK_ICON[brick.kind];
            return brick.active ? (
              <Chip
                key={`${brick.id}@${brick.from}`}
                icon={<Icon size={ICON.meta} />}
                selected
                testId={`task-capture-brick-${brick.kind}`}
                onRemove={() => toggle(brick)}
                removeLabel={t("tasks.captureBrickOff", { text: brick.text })}
              >
                {label(brick)}
              </Chip>
            ) : (
              <Chip key={`${brick.id}@${brick.from}`} icon={<Icon size={ICON.meta} />} tone="muted" onClick={() => toggle(brick)}>
                <span aria-label={t("tasks.captureBrickOn", { text: brick.text })}>{brick.text}</span>
              </Chip>
            );
          })}
        </div>
      )}
      {extras?.({ result, vocab, submit })}
      <p className="pv-capture-hint" id={hintId} role={needsTitle ? "alert" : undefined}>
        {needsTitle ? t("tasks.captureNeedsTitle") : t("tasks.captureHint")}
      </p>
    </div>
  );
}
