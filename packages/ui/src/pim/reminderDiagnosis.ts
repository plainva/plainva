/**
 * Why a reminder count is what it is (plan Mobile-Feedback, P1/5).
 *
 * Task reminders hang on conditions the app never spoke about: the switch, a
 * task database (which reaches a phone ONLY through the settings sync), and a
 * due column actually typed as a date. Each of them produces the same outcome
 * — no notification, no explanation, nothing to try next. That silence IS the
 * finding: "I don't get task reminders" had no answer inside the app.
 *
 * Shared rather than written twice, because the vocabulary is the same on both
 * shells and a second copy would drift the moment one of them gains a reason.
 * Pure and i18n-free: it returns the key and the numbers, the shell says them.
 */

export type ReminderReason =
  /** Both switches are off — the switches themselves say so. */
  | "off"
  /** Notification permission was declined; a banner already covers it. */
  | "denied"
  /** Appointments plan, tasks are switched off. Not a fault. */
  | "tasksOff"
  /** No task database is set on this device. The commonest silence. */
  | "noTaskDb"
  /** The database is set but could not be read. */
  | "taskDbUnreadable"
  /** Rows exist, but not one due value parsed as a date. */
  | "taskDueNotDate"
  | "ok";

export interface ReminderRunState {
  /** How many of the planned reminders are appointments, and how many tasks. */
  events: number;
  tasks: number;
  /** When the last planning run finished — null before the first one. */
  lastRunTs: number | null;
  reason: ReminderReason;
}

export interface ReminderDiagnosis {
  /** Parameters for `reminders.diagPlanned`. */
  planned: { events: number; tasks: number; time: string };
  /** A second sentence, only when a zero does NOT mean "there is nothing". */
  reasonKey: string | null;
}

const REASON_KEYS: Partial<Record<ReminderReason, string>> = {
  noTaskDb: "reminders.diagNoTaskDb",
  taskDbUnreadable: "reminders.diagTaskDbUnreadable",
  taskDueNotDate: "reminders.diagTaskDueNotDate",
};

/**
 * The diagnosis line, or null when there is nothing worth saying.
 *
 * Null in three cases: nothing has been planned yet, nothing is switched on,
 * and permission was refused. The latter two already have a control or a
 * banner that says it plainly, and repeating them underneath would train the
 * reader to skip this line — which is the one place the non-obvious reasons
 * appear.
 *
 * `tasksOff` deliberately gets no second sentence: the switch above it is the
 * explanation, and "task reminders are off" under an off switch is noise.
 */
export function reminderDiagnosis(
  state: ReminderRunState,
  formatTime: (ts: number) => string
): ReminderDiagnosis | null {
  if (state.reason === "off" || state.reason === "denied") return null;
  if (state.lastRunTs === null) return null;
  return {
    planned: { events: state.events, tasks: state.tasks, time: formatTime(state.lastRunTs) },
    reasonKey: REASON_KEYS[state.reason] ?? null,
  };
}
