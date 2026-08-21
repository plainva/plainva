/**
 * What a reminder says (plan Mobile-Feedback, P1).
 *
 * Three shells announced the same reminder in three different sentences:
 * Android and iOS put the bare time in the body, the desktop toast repeated
 * whatever the notification had. None of them said WHAT it was about — and on
 * Android that mattered most, because the small icon is the platform default,
 * so a task and an appointment arrived looking and reading identically.
 *
 * One sentence, three outputs: "Termin · 09:30", "Aufgabe · fällig heute".
 * The kind comes first because it is the thing the icon cannot carry on every
 * platform.
 *
 * Pure, with the words injected rather than imported: this lives next to the
 * planner, which is deliberately free of i18n so its decisions stay testable
 * without a language file.
 */

import type { ReminderSubject } from "./reminderPlan";

export interface ReminderTextLabels {
  /** "Termin" / "Appointment". */
  kindEvent: string;
  /** "Aufgabe" / "Task". */
  kindTask: string;
  /** What an all-day appointment says instead of a time. */
  allDay: string;
  /** Stand-in for an appointment that carries no title at all. */
  untitled: string;
  /** A task due today, without a time of day. */
  dueToday: string;
  /** A task due on another day, without a time of day. */
  dueOn: (date: string) => string;
}

export type ReminderTextSubject = Pick<
  ReminderSubject,
  "kind" | "title" | "startTs" | "allDay" | "startDate"
>;

export interface ReminderText {
  title: string;
  body: string;
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

/**
 * Title and body for one reminder.
 *
 * `now` decides only whether a dateless task reads "due today" or names its
 * day — passing it in keeps the function pure and the test free of the clock.
 */
export function reminderText(
  subject: ReminderTextSubject,
  labels: ReminderTextLabels,
  opts: { locale: string; now: number }
): ReminderText {
  const title = subject.title.trim() || labels.untitled;
  const isTask = subject.kind === "task";
  const kind = isTask ? labels.kindTask : labels.kindEvent;

  let when: string;
  if (!subject.allDay) {
    when = new Intl.DateTimeFormat(opts.locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(subject.startTs)
    );
  } else if (isTask) {
    // A task without a time is a day, and a day is best said in words: "due
    // today" beats a date the reader has to compare against the calendar.
    when = sameLocalDay(subject.startTs, opts.now)
      ? labels.dueToday
      : labels.dueOn(
          new Intl.DateTimeFormat(opts.locale, { weekday: "short", day: "2-digit", month: "2-digit" }).format(
            new Date(subject.startTs)
          )
        );
  } else {
    when = labels.allDay;
  }

  return { title, body: `${kind} · ${when}` };
}
