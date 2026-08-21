/**
 * What to remind of, and when (S10).
 *
 * The phone hands its reminders to the operating system, which then fires them
 * with the app closed and the screen locked. The price is Apple's hard ceiling:
 * **at most 64 pending local notifications per app**. Beyond that iOS discards
 * silently — no error, nothing in a log. A planner that ignored this would look
 * perfect in every test and lose appointments on a busy fortnight.
 *
 * So the plan is deliberately shaped around that ceiling: sort by the moment
 * each reminder fires, fill up to the limit, and say **from when on** the plan
 * no longer reaches. Swallowing the rest quietly is the one behaviour this must
 * never have.
 *
 * Pure on purpose: the interesting decisions are here, testable without a
 * device, and the shell only turns the result into notifications.
 */

export interface ReminderRule {
  /** Lead time used when the appointment itself carries no reminder. */
  defaultLeadMinutes: number;
  /** All-day appointments: this many days before the first day … */
  allDayLeadDays: number;
  /** … at this minute of that day (local). 1140 = 19:00. */
  allDayAtMinutes: number;
  /**
   * Tasks whose due date carries no time of day: this many days before the due
   * day … (plan Mobile-Feedback, E1).
   *
   * Their own rule, not the all-day one. A task due Friday and an appointment
   * lasting all Friday are not the same errand: the appointment wants a heads-up
   * the evening before, the task wants the morning OF the day, while there is
   * still time to do it. Sharing one rule meant the phone announced "hand in the
   * tax return" at 19:00 the night before and never again — and no line in the
   * settings said so.
   */
  taskLeadDays: number;
  /** … at this minute of that day (local). 540 = 09:00. */
  taskAtMinutes: number;
}

export interface ReminderSubject {
  /** Stable identity of the appointment (provider uid) or of the task (its
   * note path). */
  key: string;
  /** What this reminder is about. With a time, a task is planned exactly like
   * an appointment — the lead time. Without one it follows the task rule
   * rather than the all-day rule (E1): the same shape of question, answered
   * separately, because a due day and a day-long appointment want different
   * moments. What else differs is what a tap and the buttons do (S11). */
  kind?: "event" | "task";
  title: string;
  /** Start of the appointment, as an instant. */
  startTs: number;
  allDay: boolean;
  /** Civil start date (`YYYY-MM-DD`) of an all-day appointment — the day the
   * reader means, which no timezone may shift. */
  startDate?: string;
  /**
   * The appointment's own reminders in minutes before the start (S9), and the
   * distinction that decides everything here: `[]` is the appointment saying
   * "remind me of NOTHING", `undefined` is it saying nothing at all — then the
   * rule applies.
   */
  reminders?: number[];
  accountId: string;
  calendarId: string;
}

export interface PlannedReminder {
  /** When it fires. */
  at: number;
  subject: ReminderSubject;
  /** Minutes before the start this stands for; absent for the all-day rule,
   * which names a time of day rather than an offset. */
  leadMinutes?: number;
}

export interface ReminderPlan {
  reminders: PlannedReminder[];
  /**
   * The first moment the plan can no longer cover because the ceiling was
   * reached — the honest version of "and everything after that is missing".
   * Absent when everything fit.
   */
  truncatedFrom?: number;
  /** How many reminders the ceiling cut off. */
  dropped: number;
}

/**
 * Apple's ceiling for pending local notifications per app.
 *
 * Applied on Android too, where the platform is far more generous. One cap
 * means one behaviour to reason about and to describe, and it can only ever
 * under-promise — an Android phone that could hold more simply gets topped up
 * again at the next foreground switch, which happens many times a day.
 */
export const IOS_NOTIFICATION_LIMIT = 64;

/** Local midnight of a civil `YYYY-MM-DD`, plus a minute offset. */
function localDayMoment(date: string, minusDays: number, atMinutes: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - minusDays, 0, atMinutes).getTime();
}

/**
 * Turns appointments into the reminders a device should hold.
 *
 * The appointment's own reminder wins (E5): a person who set "one hour before"
 * in their calendar means it, and a blanket lead time from the app would quietly
 * overrule them. The rule only fills in where the appointment is silent.
 */
export function planReminders(
  subjects: readonly ReminderSubject[],
  rule: ReminderRule,
  opts: { now: number; windowEndTs: number; limit?: number }
): ReminderPlan {
  const limit = opts.limit ?? IOS_NOTIFICATION_LIMIT;
  const all: PlannedReminder[] = [];

  for (const subject of subjects) {
    const own = subject.reminders;
    // The appointment said "none". Not a gap to fill — an answer to respect.
    if (own && own.length === 0) continue;

    if (own && own.length > 0) {
      for (const lead of own) all.push({ at: subject.startTs - lead * 60_000, subject, leadMinutes: lead });
    } else if (subject.allDay && subject.startDate) {
      // A day-long subject has no useful "minutes before": midnight is not when
      // anyone wants to hear about it. It gets a time of day instead — and
      // which time depends on what it is (E1): a task is due ON its day.
      const isTask = subject.kind === "task";
      const at = localDayMoment(
        subject.startDate,
        isTask ? rule.taskLeadDays : rule.allDayLeadDays,
        isTask ? rule.taskAtMinutes : rule.allDayAtMinutes
      );
      if (at !== null) all.push({ at, subject });
    } else {
      all.push({ at: subject.startTs - rule.defaultLeadMinutes * 60_000, subject, leadMinutes: rule.defaultLeadMinutes });
    }
  }

  const due = all
    .filter((r) => r.at > opts.now && r.at <= opts.windowEndTs)
    // Ties broken by title so two devices planning the same fortnight agree on
    // which reminder the ceiling cuts.
    .sort((a, b) => a.at - b.at || a.subject.title.localeCompare(b.subject.title) || a.subject.key.localeCompare(b.subject.key));

  if (due.length <= limit) return { reminders: due, dropped: 0 };
  return { reminders: due.slice(0, limit), truncatedFrom: due[limit].at, dropped: due.length - limit };
}
