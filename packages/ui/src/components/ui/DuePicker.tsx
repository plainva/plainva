import { useMemo, useState } from "react";
import { Ban, Bell, BellOff, Calendar, CalendarDays, Clock, Sofa, Sun, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/iconSizes";
import type { WeekStartDay } from "../../lib/calendarGrid";
import { DUE_TIME, dueQuickChoices, type DuePick, type DueQuickId } from "../../lib/dueQuickChoices";
import { minutesToTime, nextHalfHourMinutes } from "../../pim/taskTimeBlock";
import { DateJumpPicker } from "./DateJumpPicker";
import { Button } from "./Button";
import { TextInput } from "./Field";
import { Switch } from "./Switch";
import { cx } from "./cx";

/**
 * "Change due date" (wishes 2026-10-24, E2): the date jump with a head and a
 * foot, for every place a task gets its due date — the desktop's popover and
 * the phone's sheet render this one component.
 *
 * On top the quick choices of Apple Reminders (Today, Tomorrow, This weekend,
 * Next week, No date; `dueQuickChoices` is their one definition), the month
 * grid below, and at the foot the time row: a switch — off is all day — and,
 * when on, the time field. A pick, quick or from the grid, carries the time
 * row along, so a quick choice keeps a time the task already has. A time
 * changed without a new day is taken with "Done".
 *
 * Every task takes a time: a database entry in its due value, a checkbox in a
 * note right after its `📅` date (plan Rückmeldungen 2026-11-05, E3). Where a
 * checkbox's time would not remind — the vault's "Checkboxes with a time" is
 * off — the picker shows that switch under the time, the setting itself and
 * not a copy, so the time written is not a feature one cannot find.
 */
export interface DuePickerProps {
  /** The day the task carries now (ISO), or null for a task without one. */
  day: string | null;
  /** The time it carries now (`HH:MM`), or null when it is due all day. */
  time: string | null;
  /**
   * A checkbox in a note: the vault's "Checkboxes with a time" reminder switch.
   * Off when the picker opens, it stands under the time while a time is chosen.
   */
  checkboxReminders?: { on: boolean; onChange: (on: boolean) => void };
  /** The calendar's today (`useTodayKey`): what Today, Tomorrow and the week are counted from. */
  todayKey: string;
  weekStart: WeekStartDay;
  onPick: (pick: DuePick) => void;
  onClose?: () => void;
  /** `sheet` raises the rows to touch height. */
  size?: "ui" | "sheet";
  autoFocus?: boolean;
  /** Base for the test ids: `<testId>-quick` and `-quick-<id>`, `-time-switch`, `-time`, `-time-done`, `-reminders`; the grid is `<testId>-grid`. */
  testId?: string;
}

const QUICK_ICON: Record<DueQuickId, LucideIcon> = {
  today: Calendar,
  tomorrow: Sun,
  weekend: Sofa,
  nextWeek: CalendarDays,
  none: Ban,
};

const QUICK_LABEL: Record<DueQuickId, string> = {
  today: "tasks.plannerToday",
  tomorrow: "tasks.captureQuickTomorrow",
  weekend: "tasks.dueQuickWeekend",
  nextWeek: "tasks.dueQuickNextWeek",
  none: "tasks.dueNone",
};

export function DuePicker({ day, time, checkboxReminders, todayKey, weekStart, onPick, onClose, size = "ui", autoFocus = false, testId = "task-due" }: DuePickerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const [timeOn, setTimeOn] = useState(time !== null);
  // Switching the time on starts at the task's own time, else at the next half hour.
  const [clock, setClock] = useState(() => time ?? minutesToTime(nextHalfHourMinutes(new Date())));
  const chosenTime = timeOn && DUE_TIME.test(clock) ? clock : null;
  // Asked once, when the picker opens: a switch turned on here stays in view.
  const [remindersWereOff] = useState(() => checkboxReminders !== undefined && !checkboxReminders.on);
  const choices = useMemo(() => dueQuickChoices(todayKey, weekStart), [todayKey, weekStart]);
  const weekday = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: "short" }), [lang]);
  // The row of the day the task carries now; where two stand for the same day (Today and This weekend on a Saturday), the first.
  const current = choices.find((choice) => choice.day === day)?.id;

  const pick = (next: string | null) => onPick({ day: next, time: next === null ? null : chosenTime });
  // Only the time moved: "Done" takes it, on the task's day (or today for a task without one).
  const timeChanged = chosenTime !== time;

  return (
    <div className={cx("pv-datejump-due", size === "sheet" && "pv-datejump-due--sheet")}>
      <div className="pv-datejump-quick" role="group" aria-label={t("tasks.dueChange")} data-testid={`${testId}-quick`}>
        {choices.map((choice) => {
          const Icon = QUICK_ICON[choice.id];
          return (
            <button
              key={choice.id}
              type="button"
              className={cx("pv-datejump-qitem", `pv-datejump-qitem--${choice.id}`)}
              aria-pressed={choice.id === current}
              data-testid={`${testId}-quick-${choice.id}`}
              onClick={() => pick(choice.day)}
            >
              <Icon size={size === "sheet" ? ICON.head : ICON.ui} aria-hidden="true" />
              <span className="pv-datejump-qlabel">{t(QUICK_LABEL[choice.id])}</span>
              {choice.day && <span className="pv-datejump-qday">{weekday.format(new Date(`${choice.day}T00:00:00`))}</span>}
            </button>
          );
        })}
      </div>
      <DateJumpPicker
        value={day ?? todayKey}
        weekStart={weekStart}
        onPick={pick}
        onClose={onClose}
        size={size}
        autoFocus={autoFocus}
        testId={`${testId}-grid`}
      />
      <div className="pv-datejump-time" data-testid={`${testId}-timerow`}>
        <Clock size={ICON.ui} aria-hidden="true" />
        <span className="pv-datejump-tlabel">{t("tasks.dueTime")}</span>
        <Switch checked={timeOn} onChange={setTimeOn} label={t("tasks.dueTime")} testId={`${testId}-time-switch`} />
        {timeOn && (
          <TextInput
            compact
            type="time"
            className="pv-datejump-tfield"
            aria-label={t("tasks.dueTime")}
            data-testid={`${testId}-time`}
            value={clock}
            onChange={(e) => setClock(e.target.value)}
          />
        )}
        {timeChanged && (
          <Button variant="tonal" size="sm" onClick={() => onPick({ day: day ?? todayKey, time: chosenTime })} data-testid={`${testId}-time-done`}>
            {t("common.done")}
          </Button>
        )}
      </div>
      {checkboxReminders && remindersWereOff && timeOn && (
        <div className="pv-datejump-time" data-testid={`${testId}-reminders`}>
          {checkboxReminders.on ? <Bell size={ICON.ui} aria-hidden="true" /> : <BellOff size={ICON.ui} aria-hidden="true" />}
          <span className="pv-datejump-hint pv-datejump-tnote">{t(checkboxReminders.on ? "tasks.dueTimeRemindersOn" : "tasks.dueTimeRemindersOff")}</span>
          <Switch checked={checkboxReminders.on} onChange={checkboxReminders.onChange} label={t("reminders.checkboxes")} testId={`${testId}-reminders-switch`} />
        </div>
      )}
    </div>
  );
}
